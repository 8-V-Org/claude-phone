#!/usr/local/bin/node
const fs=require('node:fs');const a=process.argv.slice(2),out=a[a.indexOf('--out')+1];fs.appendFileSync(process.env.FAKE_CLI_COUNT,'x');
if(a[0]==='transcribe'){const input=a[a.indexOf('-i')+1];if(fs.readFileSync(input).toString('ascii',0,4)!=='RIFF')process.exit(2);fs.writeFileSync(out,'Turn on the light.');}
else{let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{if(!s)process.exit(2);const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVE',8);fs.writeFileSync(out,b);});}
