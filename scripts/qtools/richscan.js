const fs=require('fs'); const vm=require('vm');
const noop=()=>{};const el=new Proxy(function(){},{get:(t,p)=>p==='length'?0:el,apply:()=>el});const ctx={document:el,window:el,localStorage:el,location:el,navigator:el,setTimeout:noop,setInterval:noop,Site:undefined,console}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../../public/js/ui.js'),'utf8')+';this.rich=rich;',ctx);
for (const f of process.argv.slice(2)) { const Q=JSON.parse(fs.readFileSync(f,'utf8')).questions; const bad=[];
  Q.forEach((q,i)=>{for (const k of ['question','A','B','C','D','explanation']) { const h=ctx.rich(q[k]||'').replace(/<[^>]+>/g,''); if (/[\^_√]/.test(h)) bad.push(`${i+1}${k[0]}: ${h.slice(0,70)}`);}});
  console.log(f, Q.length, 'flagged', bad.length); bad.slice(0,8).forEach(b=>console.log('  ',b)); }
