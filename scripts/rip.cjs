#!/usr/bin/env node
const path = require('path');
const { ripRom } = require('../app/rip');
const args=process.argv.slice(2);
if(args.length<2||args.length>3){console.error('Usage: npm run rip -- /path/to/game.sfc-or.zip /path/to/output [mp3|wav|midi]');process.exit(2)}
let last='';
ripRom([path.resolve(args[0])],path.resolve(args[1]),p=>{
  const text=p.phase==='track'?`Saved ${p.file}`:p.label||p.text;
  if(text&&text!==last){console.log(text);last=text}
},path.resolve('.cache'), {format:args[2]||'mp3'}).then(r=>{console.log(JSON.stringify(r,null,2));process.exitCode=r.ok?0:1}).finally(()=>require('../app/render').shutdown());
