#!/usr/bin/env python3
"""Create a self-contained Logic session; frozen into the app, never needs user Python."""
import json, struct, sys, base64, wave, plistlib, math, bisect
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'vendor'))
from logicx import projectdata as P


def block(kind, data, name='', index=0):
    h = bytearray(84)
    struct.pack_into('<III', h, 0, 0x101 | kind << 24, len(data), index)
    h[16:20] = b'TBOS'
    n = name.encode('utf-8')[:63]
    h[20:20+len(n)] = n
    return h + data


def sampler(template, sample, filename, ordinal, sample_dir):
    # One sample per Sampler: C4 is unity speed at the original 32 kHz rate.
    # Instrument state is embedded; collected samples live inside Media/Samples.
    frames = sample['frames']
    zone = bytearray(96)
    zone[1], zone[7], zone[9], zone[10] = 60, 127, 1, 127
    struct.pack_into('<III', zone, 16, frames, sample['loopStart'], frames)
    zone[33] = int(sample['loop'])
    struct.pack_into('<b', zone, 80, sample.get('detune',0))
    struct.pack_into('<i', zone, 88, -1)
    ref = bytearray(592)
    struct.pack_into('<IIIIII', ref, 0, 44, frames, 32000, 16, 1, 1)
    ref[28:32] = b'EVAW'
    struct.pack_into('<I', ref, 32, frames * 2 + 44)
    name = filename.encode('ascii')
    ref[336:336+len(name)] = name
    directory = str(sample_dir).encode("utf-8")
    if len(directory)>255: raise ValueError("The export folder path is too long for Logic Sampler. Choose a shorter output path.")
    ref[80:80+len(directory)] = directory
    params = bytearray(template[468:1660])
    count = struct.unpack_from('<I', params, 84)[0]
    # Native Sampler bend range is stored in the EXS parameter table (IDs 3 and 4).
    # -1 means the downward range follows the upward range.
    for i in range(count):
        key = params[88+i]
        if key in (3, 4):
            struct.pack_into('<h', params, 88+count+2*i, 12 if key == 3 else -1)
    exs = template[296:468] + block(1, zone, filename) + block(3, ref, filename) + params
    result = bytearray(template[:296] + exs + template[1660:])
    delta = len(result)-len(template)
    for offset in (0x1c, 0xb8, 0xd0):
        struct.pack_into('<I', result, offset, P._u32(template, offset)+delta)
    struct.pack_into('<I', result, 12, ordinal)
    return bytes(result)


def controller(tick, status, data1, data2):
    e = bytearray(16)
    e[0], e[11], e[12], e[15] = status, data2, data1, 1
    if status == 0xe0:
        e[10] = data1 << 1
    struct.pack_into('<I', e, 4, P.ProjectData.MIDI_NOTE_ORIGIN+tick)
    return e


def musical_clock(timing):
    origin = timing.get('originSeconds', 0)
    points = timing.get('tempo', [{'time': 0, 'bpm': 120}])
    meter = timing.get('meter', [4, 4])
    if not math.isfinite(origin) or not 0 <= origin <= 600 or not 1 <= len(points) <= 4096:
        raise ValueError('Invalid musical timing.')
    if len(meter) != 2 or not isinstance(meter[0], int) or not 1 <= meter[0] <= 32 or meter[1] not in (1, 2, 4, 8, 16):
        raise ValueError('Invalid meter.')
    times, bpms, beats = [], [], []
    beat = 0
    for p in points:
        t, bpm = p['time'], p['bpm']
        if not math.isfinite(t) or not 0 <= t <= 600 or not math.isfinite(bpm) or not 20 <= bpm <= 400 or (times and t <= times[-1]):
            raise ValueError('Invalid tempo point.')
        if times: beat += (t-times[-1])*bpms[-1]/60
        times.append(t); bpms.append(round(bpm, 4)); beats.append(beat)
    if times[0] != 0: raise ValueError('Tempo map must start at zero.')
    def position(seconds):
        i = max(0, bisect.bisect_right(times, seconds)-1)
        return beats[i]+(seconds-times[i])*bpms[i]/60
    offset = position(origin)
    def to_tick(seconds):
        return max(0, round((position(seconds)-offset)*960))
    tempo = {0: bpms[max(0, bisect.bisect_right(times, origin)-1)]}
    for t, bpm in zip(times, bpms):
        if t > origin: tempo[to_tick(t)] = bpm
    return to_tick, list(tempo.items()), meter


def performance(notes, to_tick=lambda t: round(t*1920)):
    events = []
    for n in notes:
        start = to_tick(n['start'])
        length = max(1, to_tick(n['end'])-start)
        events.append((start, 2, bytearray(P.ProjectData._enc_note_event(start,n['note'],n['velocity'],length,False))))
        events.append((start, 0, controller(start,0xb0,10,n['pan'])))
        for bend in n['bends']:
            if bend['time'] >= n['end']: continue
            pos = to_tick(bend['time'])
            value = max(0,min(16383,round(8192+bend['semitones']/12*8192)))
            events.append((pos,1,controller(pos,0xe0,value&127,value>>7)))
    events.sort(key=lambda e:(e[0],e[1]))
    if events: events[-1][2][15] |= 0x80
    return b''.join(e[2] for e in events)+P.ProjectData.NOTE_QSVE_TAIL


def export(data, out, template):
    groups = data['tracks']
    to_tick, tempo, meter = musical_clock(data.get('timing', {}))
    if not groups or len(groups)>256: raise ValueError('Logic export supports 1–256 sampler tracks per sound.')
    pd, files = P._resolve_base(None, 'mixed_base')
    P._grow_pool_if_needed(pd, len(groups)-1, P.IdGen())
    P.synthesize_av_tracks(pd, instruments=len(groups)-1, inst_infra=P._baked_infra()['instrument_infra'])
    # Drop the seed's empty audio arrange row before placing MIDI. Keep the mixer pool.
    audio_channels = set(P._mixer_audio_chans(pd))
    pd.records = [r for r in pd.records if not (r.tag==b'karT' and len(r.raw)==93 and P._u32(r.raw,8)==0x40000 and P._u32(r.raw,P.KART_CHAN) in audio_channels)]
    rows = [r for r in pd.records if r.tag==b'karT' and len(r.raw)==93 and P._u32(r.raw,8)==0x40000]
    for i,r in enumerate(rows):
        b=bytearray(r.raw);struct.pack_into('<H',b,18,i);r.raw=bytes(b)
    P._synth_arrange_height(pd.records,len(groups))
    channels = P._instrument_arrange_positions(pd)
    strips = []
    for i,g in enumerate(groups,1):
        ch=channels[i][1]
        strips.append(P._ocua_for_channel(pd,ch))
        iv=next(r for r in pd.records if r.tag==b'ivnE' and P._u32(r.raw,8)==ch)
        iv.raw=P._set_ivne_name(iv.raw,g['name'])
    specs=[(i,[(to_tick(n['start']),n['note'],n['velocity'],max(1,to_tick(n['end'])-to_tick(n['start']))) for n in g['notes']],0,g['name']) for i,g in enumerate(groups,1)]
    region_ids=P.synthesize_midi_regions(pd,specs,prototype=P._baked_infra()['midi_region_proto'])
    for rid,g in zip(region_ids,groups):
        r=next(r for r in pd.records if r.tag==b'qSvE' and P._u32(r.raw,8)==rid)
        payload=performance(g['notes'], to_tick);h=bytearray(r.raw[:36]);struct.pack_into('<I',h,28,len(payload));r.raw=bytes(h)+payload
    for strip,g in zip(strips,groups):
        if strip is None: raise ValueError('Missing Logic channel strip.')
        ordinal=P._u32(strip.raw,12)
        # Schema 6 stores insert capacity at 0x3e; grow BOTH it and the bitmap.
        b=bytearray(strip.raw);capacity=struct.unpack_from('<H',b,0x3e)[0]
        if capacity<4:
            b[168:168]=bytes((4-capacity)*4)
            struct.pack_into('<H',b,0x3e,4)
        struct.pack_into('<I',b,176,1)
        struct.pack_into('<I',b,28,len(b)-36)
        strip.raw=bytes(b)
        pd.records=[r for r in pd.records if not (r.tag==b'UCuA' and P._u32(r.raw,12)==ordinal and struct.unpack_from('<H',r.raw,18)[0]==2)]
        state=sampler(template,data['samples'][g['sample']],g['sample']+'.wav',ordinal,Path(data.get('destination',str(out.resolve())))/'Media'/'Samples')
        pd.records.insert(pd.records.index(strip)+1,P.Record(b'UCuA',state))
    pd.set_tempo_map(tempo)
    pd.set_meter_map([(0, *meter)])
    encoded=pd.serialize()
    if P.ProjectData.parse(encoded).serialize()!=encoded: raise ValueError('Invalid Logic project structure.')
    P._assemble_bundle(files,out,encoded,added_tracks=len(groups)-2)
    media=out/'Media'/'Samples';media.mkdir(parents=True)
    for name,s in data['samples'].items():
        with wave.open(str(media/(name+'.wav')),'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(32000)
            w.writeframes(base64.b64decode(s['pcm']))
    # Clear seed metadata unrelated to this newly authored song.
    mp=out/'Alternatives/000/MetaData.plist'
    md=plistlib.loads(mp.read_bytes());md['NumberOfTracks']=len(groups)
    md['BeatsPerMinute']=tempo[0][1]
    md['SongSignatureNumerator'],md['SongSignatureDenominator']=meter
    mp.write_bytes(plistlib.dumps(md,fmt=plistlib.FMT_BINARY))
    return {'tracks':len(groups),'samples':len(data['samples']),'notes':sum(len(g['notes']) for g in groups)}


if __name__=='__main__':
    try:
        spec=json.load(sys.stdin)
        out=Path(sys.argv[1])
        if out.exists(): raise FileExistsError('Refusing to overwrite a Logic project.')
        result=export(spec,out,Path(sys.argv[2]).read_bytes())
        print(json.dumps(result))
    except Exception as e:
        print(str(e),file=sys.stderr);sys.exit(1)
