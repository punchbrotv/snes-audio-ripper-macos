"""Compose real public-domain photographs with Pillow. No generative image tools.
Run: python3 -m pip install Pillow; python3 scripts/make-readme-art.py
The fonts below ship with macOS; they are rasterized, never redistributed.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import json
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/assets'
FONT = Path('/System/Library/Fonts/Supplemental')
INK, PURPLE, PAPER, LILAC = '#24212f', '#6640b2', '#f6f3ec', '#d9ccef'

def font(n, bold=False):
    return ImageFont.truetype(str(FONT / ('Arial Bold.ttf' if bold else 'Arial.ttf')), n)

def text(im, xy, s, n=24, fill=INK, bold=False):
    ImageDraw.Draw(im).text(xy, s, font=font(n, bold), fill=fill)

def photo(key, size):
    im = Image.open(OUT / 'source' / (key+'.jpg')).convert('RGB')
    return ImageOps.contain(im, size, Image.Resampling.LANCZOS)

def card(base, key, xy, size, angle=0):
    w,h = size
    tile = Image.new('RGB',size,'white')
    pic = photo(key,(w-28,h-28))
    tile.paste(pic,((w-pic.width)//2,(h-pic.height)//2))
    ImageDraw.Draw(tile).rectangle((0,0,w-1,h-1),outline='#ddd8e5',width=2)
    tile=tile.convert('RGBA').rotate(angle,Image.Resampling.BICUBIC,expand=True)
    base.paste(tile,xy,tile)

def save(im,name):
    im.convert('RGB').save(OUT/(name+'.jpg'),quality=89,optimize=True,progressive=True)

keys=['snes-console','snes-controller','sfc','scope','receiver','sfc-back','mouse','snes-front']
hero=Image.new('RGB',(1800,820),PAPER)
d=ImageDraw.Draw(hero)
d.rectangle((760,0,1800,820),fill=LILAC)
for x in range(785,1800,40):d.line((x,0,x,820),fill='#c9b8e5')
for y in range(0,820,40):d.line((760,y,1800,y),fill='#c9b8e5')
text(hero,(64,52),'PUNCHBRO  /  macOS EDITION',24,PURPLE,True)
text(hero,(58,125),'SNES',148,INK,True)
text(hero,(64,290),'AUDIO',100,INK,True)
text(hero,(64,394),'RIPPER',100,INK,True)
text(hero,(68,535),'Your cartridge. Your soundtrack.',32,INK,True)
text(hero,(68,587),'Drop a ROM. Extract. Press play.',27)
d.rounded_rectangle((64,663,593,727),radius=10,fill=PURPLE)
text(hero,(87,680),'APPLE SILICON  /  MP3 EXPORT',25,'white',True)
card(hero,'snes-console',(820,46),(870,430),-4)
card(hero,'sfc',(1110,448),(600,300),5)
card(hero,'snes-controller',(770,470),(415,245),-9)
text(hero,(65,777),'ORIGINAL APP: SAMSQWAMCH  •  PORT: PUNCHBRO + CODEX',18)
save(hero,'hero')
sections=[('download','PRESS START',[0,1,7]),('use','DROP. RIP. PLAY.',[1,6,0]),('inside','INSIDE THE SOUND',[2,5,7]),('compatibility','THE TEST BENCH',[0,7,1]),('build','BUILD YOUR OWN',[5,6,2]),('credits','PLAYER TWO',[0,2,1]),('gallery','MORE SNES. YES.',[3,4,6]),('footer','THANKS FOR PLAYING',[7,1,0])]
for index,(name,title,ids) in enumerate(sections):
    im=Image.new('RGB',(1800,265),PURPLE if index%2==0 else INK)
    text(im,(36,29),f'{index+1:02} / SNES AUDIO RIPPER',21,LILAC)
    # Split long headings into two intentional lines.
    words=title.split(); lines=[title]
    if len(title)>17:lines=[' '.join(words[:-1]),words[-1]]
    for j,line in enumerate(lines):text(im,(34,88+j*58),line,46,'white',True)
    for j,k in enumerate(ids):card(im,keys[k],(690+j*365,10),(350,240),[-3,3,-2][j])
    save(im,name)
wall=Image.new('RGB',(1800,1210),PAPER)
text(wall,(45,28),'WE MAY HAVE A SUPER NINTENDO PROBLEM.',48,INK,True)
text(wall,(48,98),'8 real photos. 12 frames. Absolutely no restraint.',27,PURPLE)
for i,k in enumerate([0,1,2,7,6,3,4,5,2,0,7,1]):
    card(wall,keys[k],(26+(i%4)*444,161+(i//4)*345),(418,319),[-2,2,-1,1][i%4])
save(wall,'wall')
for key in keys:
    p=photo(key,(960,600)); tile=Image.new('RGB',(960,600),'white');tile.paste(p,((960-p.width)//2,(600-p.height)//2));save(tile,'photo-'+key)
print('Composed hero, eight banners, photo wall, and eight gallery images.')

# Extra, intentionally maximalist contact sheets. Every frame is a real source photo.
catalog=json.loads((OUT/'source/catalog.json').read_text())
def source_path(item):
    return OUT/item.get('local','source/'+item['id']+'.jpg')
def archive_card(base,item,xy,size):
    w,h=size;tile=Image.new('RGB',size,'white')
    src=Image.open(source_path(item)).convert('RGB')
    pic=ImageOps.contain(src,(w-24,h-24),Image.Resampling.LANCZOS)
    tile.paste(pic,((w-pic.width)//2,(h-pic.height)//2))
    ImageDraw.Draw(tile).rectangle((0,0,w-1,h-1),outline='#d4c7e9',width=2)
    base.paste(tile,xy)
for sheet in range(8):
    im=Image.new('RGB',(1800,1150),PAPER if sheet%2==0 else LILAC)
    titles=['WELCOME TO THE HARDWARE AISLE.','THE CONTROLLER SITUATION IS ESCALATING.',
            'PLEASE ENJOY THESE ADDITIONAL CONSOLES.','YES, WE PHOTOGRAPHED THE BACK TOO.',
            'THE CIRCUIT BOARD APPRECIATION SOCIETY.','THERE IS ALWAYS ANOTHER PERIPHERAL.',
            'THE SNES IMAGES WILL CONTINUE.','YOU THOUGHT THAT WAS THE LAST SNES.']
    text(im,(32,22),titles[sheet],35,INK,True)
    text(im,(34,75),f'CONTACT SHEET {sheet+1:02}  /  REAL HARDWARE  /  PUBLIC-DOMAIN PHOTOGRAPHY',20,PURPLE)
    for i in range(20):
        idx=(sheet*17+i)%len(catalog)
        archive_card(im,catalog[idx],(24+(i%5)*354,126+(i//5)*251),(336,235))
    save(im,f'contact-{sheet+1:02}')
print(f'Composed 8 additional contact sheets: 160 photo placements from {len(catalog)} source photos.')
