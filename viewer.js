"use strict";
const $ = id => document.getElementById(id);
const cases = window.catalog;
const config = {responsive:true,displaylogo:false,scrollZoom:false,toImageButtonOptions:{format:"png",scale:3}};
const columns = ["Probe phase","Physical idler phase","Probe amplitude","Idler amplitude"];
const units = ["rad","rad","dB","dB"];
const palette = [[0,"#230878"],[.20,"#4653ba"],[.42,"#84f6fa"],[.55,"#3e7c0c"],[.74,"#f6dc23"],[.88,"#eea41a"],[1,"#982622"]];
const lineColors=["#16788c","#ac542b","#186a71","#6254ab"];
const cache = new Map();
const current = {view:"response", power:-104.5, frequency:0, ticket:0};
const views = {response:"Frequency cuts",powercut:"Power cuts",map:"Power and frequency maps",surface:"Rotatable response surfaces",healing:"Response around the healing scale",branches:"Local Bogoliubov branches",evolution:"Sideband evolution along the line"};
function option(sel,values,label=String) {
  sel.replaceChildren(...values.map(value=>new Option(label(value),value)));
}
function closest(arr,v) {
  return arr.reduce((best,x,i)=>Math.abs(x-v)<Math.abs(arr[best]-v)?i:best,0);
}
function selection() {
  return cases.find(c=>c.fit===$("fit").value && c.pump===+$("pump").value && c.loss===Boolean(+$("loss").value) && c.order===+$("order").value);
}
function pumps() {
  const old=+$("pump").value || 5;
  const values=[...new Set(cases.filter(c=>c.fit===$("fit").value).map(c=>c.pump))].sort((a,b)=>a-b);
  option($("pump"),values,v=>v.toFixed(2)+" GHz");
  $("pump").value=values[closest(values,old)];
}
function loadCase(id) {
  if(cache.has(id)) return Promise.resolve(cache.get(id));
  return new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="chunks/"+id+".js";
    script.onload=async()=>{
      try {
        const [meta,b64]=window.chunks[id];
        if(meta.id!==id) throw new Error("Case mismatch");
        const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
        const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
        const decoded=await new Response(stream).arrayBuffer();
        const count=meta.x.length*meta.power.length;
        if(decoded.byteLength!==24*count) throw new Error("Data length mismatch");
        const data=new Float32Array(decoded,0,5*count);
        const fseams=new Uint8Array(decoded,20*count,2*count);
        const pseams=new Uint8Array(decoded,22*count,2*count);
        const c={...meta,data,fseams,pseams};
        if(cache.size>4) cache.delete(cache.keys().next().value);
        cache.set(id,c);
        resolve(c);
      } catch(e) { reject(e); }
      delete window.chunks[id];
      script.remove();
    };
    script.onerror=()=>reject(new Error("Could not load "+id));
    document.head.append(script);
  });
}
function pumpPhase(c,power,position=1) {
  const rho=Math.pow(10,(power-30)/10)/(2*c.zref*c.criticalCurrent**2);
  const alpha=c.carrier[1], [re,im]=c.gamma, n=position*c.cells;
  const integral=alpha===0?n:-Math.expm1(-2*alpha*n)/(2*alpha);
  return im===0?re*rho*integral:re*Math.log1p(2*im*rho*integral)/(2*im);
}
function row(c,q,p) {
  const n = c.x.length;
  const i = (q*c.power.length+p)*n;
  const raw=c.data.subarray(i,i+n);
  if(q>=2) return raw;
  const frequency=seamRow(c,q,p,"fseams"), power=seamRow(c,q,p,"pseams");
  const theta=$("phase").value==="pumpframe"?pumpPhase(c,c.power[p]):0;
  return raw.map((y,i)=>frequency[i]||power[i]?NaN:y-theta);
}
function seamRow(c,q,p,kind) {
  if(q>1) return null;
  const n=c.x.length;
  const start=(q*c.power.length+p)*n;
  return c[kind].subarray(start,start+n);
}
function finite(v) {return Number.isFinite(v)?v:null;}
function trace(x,y,name,color,nodes=null,breaks=null) {
  const xs=[], ys=[];
  for(let j=0;j<x.length;j++) {
    if(j>0 && ((nodes && nodes[j]!==nodes[j-1]) || (breaks && breaks[j]))) {xs.push(x[j]);ys.push(null);}
    xs.push(x[j]);ys.push(finite(y[j]));
  }
  return {x:xs,y:ys,name,type:"scatter",mode:nodes?"lines+markers":"lines",marker:{color,size:2},line:{color,width:1.6},connectgaps:false,
    hovertemplate:"%{x:.6g}, %{y:.6g}<extra>%{fullData.name}</extra>"};
}
function axis(title,range) {return {title:{text:title},range,gridcolor:"#e7ebf0",zerolinecolor:"#bcc9d4",automargin:true};}
function base(title,x,y,idx) {
  return {title:{text:title,x:.06,font:{size:16}},xaxis:x,yaxis:y,showlegend:false,margin:{t:48,b:60,l:68,r:31},
    font:{family:"system-ui, sans-serif",size:12,color:"#263746"},paper_bgcolor:"#fff",plot_bgcolor:"#fff",
    uirevision:[current.view,$("fit").value,$("pump").value,$("loss").value,$("order").value,$("zoom").value,$("axis").value,$("domain").value,$("phase").value,idx].join(":")};
}
function vert(x,color,dash="dot") {
  return {type:"line",xref:"x",yref:"paper",x0:x,x1:x,y0:0,y1:1,line:{width:1.25,dash,color}};
}
function cutoff(y) {
  return {type:"line",xref:"paper",yref:"y",x0:0,x1:1,y0:y,y1:y,line:{width:1.4,dash:"dash",color:"#303d45"}};
}
function getPowerIndices(c,accepted) {
  const result=c.power.map((_,i)=>i).filter(i=>!accepted || c.power[i]<=c.ceiling+1e-9);
  return result;
}
function mapGuides(c,indices) {
  const y=indices.map(i=>c.power[i]);
  const guides=[];
  [c.inlet_MHz,c.outlet_MHz].forEach((v,j)=>{
    if(j===1 && !c.loss) return;
    [-1,1].forEach(s=>{
      guides.push({x:indices.map(i=>v[i]===null?null:s*v[i]),y,mode:"lines",type:"scatter",name:j===0?"Inlet fξ":"Outlet fξ",
        line:{color:j===0?"#131b1b":"#fafafa",width:1.3,dash:j===0?"solid":"dash"},hoverinfo:"skip",showlegend:false});
    });
  });
  return guides;
}
function sampled(outer,size) {
  if(outer<=size) return Array.from({length:outer},(_,i)=>i);
  return [...new Set(Array.from({length:size},(_,i)=>Math.round((outer-1)*i/(size-1))))];
}
const mhz = "Probe detuning (MHz)";
const pdBm = "Chip pump power (dBm)";
function representativeIndices(c) {
  const ids=[closest(c.x,0),closest(c.x,-c.healing.inlet["fξ_MHz"]),closest(c.x,c.healing.inlet["fξ_MHz"])];
  return [...new Set(ids)];
}
function render(c,p,di) {
  const group=$("panels");
  const num=current.view==="branches"?2:4;
  while(group.children.length>num) {Plotly.purge(group.lastChild);group.lastChild.remove();}
  while(group.children.length<num) {const div=document.createElement("div");div.className="panel";group.append(div);}
  const edge=$("edge").value;
  const h=c.healing[edge], scale=h["fξ_MHz"];
  const inDomain=$("domain").value==="accepted";
  const pumpFrame=$("phase").value==="pumpframe";
  const absolute=$("axis").value==="frequency";
  const toX=absolute?d=>c.pump+d/1000:d=>d;
  const sweep=c.x.map(toX);
  const xTitle=absolute?"Probe frequency (GHz)":mhz;
  for(let q=0;q<num;q++) {
    const div=group.children[q];
    div.className="panel"+(current.view==="surface"?" surface":"");
    const yLabel=axis(units[q]);
    let layout=base(columns[q],axis(xTitle),yLabel,q);
    let traces=[];
    if(current.view==="response") {
      const window=$("zoom").value;
      if(window!=="full") {
        const hv=(window==="inlet"?c.inlet_MHz:c.outlet_MHz)[p];
        if(hv) layout.xaxis.range=[toX(-5*hv),toX(5*hv)];
      }
      traces=[trace(sweep,row(c,q,p),columns[q],lineColors[q],q===1&&!c.loss?row(c,4,p):null,seamRow(c,q,p,"fseams"))];
      layout.shapes=[vert(toX(0),"#657880")];
      [c.inlet_MHz[p],c.outlet_MHz[p]].forEach((fv,j)=>{
        if(fv && (j===0 || c.loss)) for(const s of [-1,1]) layout.shapes.push(vert(toX(s*fv),j?"#a25731":"#087b76",j?"dash":"dashdot"));
      });
    } else if(current.view==="powercut") {
      traces=representativeIndices(c).filter(i=>i!==di).concat(di).map((i,j)=>{
        const y=c.power.map((_,r)=>row(c,q,r)[i]);
        const nodes=q===1&&!c.loss?c.power.map((_,r)=>row(c,4,r)[i]):null;
        const breaks=q<2?c.power.map((_,r)=>seamRow(c,q,r,"pseams")[i]):null;
        return trace(c.power,y,c.x[i].toFixed(3)+" MHz",lineColors[j],nodes,breaks);
      });
      layout.xaxis=axis(pdBm,[-110,-60]);layout.showlegend=true;layout.legend={orientation:"h",y:1.1};
      layout.shapes=[vert(c.ceiling,"#087b76","dash"),vert(c.critical,"#aa4532","dash")];
    } else if(current.view==="map"||current.view==="surface") {
      const three=current.view==="surface";
      const indices=getPowerIndices(c,inDomain);
      const zoom=$("zoom").value;
      const hRange=zoom==="full"?null:5*c.healing[zoom]["fξ_MHz"];
      const visible=c.x.map((_,i)=>i).filter(i=>!hRange || Math.abs(c.x[i])<=hRange);
      const xc=visible;
      const range=inDomain?[indices.length?c.power[indices[0]]:c.ceiling-.125,c.ceiling]:[-110,-60];
      const x=xc.map(i=>sweep[i]), y=indices.map(i=>c.power[i]);
      const xUnits=absolute?"GHz":"MHz";
      const visibleRange=hRange?[toX(-hRange),toX(hRange)]:undefined;
      const guides=mapGuides(c,indices).map(g=>({...g,x:g.x.map(v=>v===null?null:toX(v))}));
      const z=indices.map(p=>{
        const values=row(c,q,p);
        return xc.map(j=>finite(values[j]));
      });
      const bounds=[];
      for(const powerRow of z) for(const value of powerRow) if(value!==null) bounds.push(value);
      bounds.sort((a,b)=>a-b);
      const lo=bounds[0]??0, hi=bounds.at(-1)??1;
      const low=bounds[Math.floor(.005*bounds.length)]??lo;
      const high=bounds[Math.max(0,Math.floor(.995*bounds.length)-1)]??hi;
      if(three) {
        const contour={show:true,start:low,end:high,size:Math.max((high-low)/12,1e-6),usecolormap:false,color:"#253447",width:1,highlight:true,project:{z:true}};
        const lowerX=x[0],upperX=x[x.length-1],floor=lo;
        traces=[{type:"surface",x,y,z,colorscale:palette,cmin:low,cmax:high,colorbar:{title:units[q],len:.7,thickness:10},
          contours:{z:contour},connectgaps:false,hovertemplate:"%{x:.7g} "+xUnits+"<br>%{y:.3f} dBm<br>%{z:.5g} "+units[q]+"<extra></extra>"},
          ...guides.map(g=>({type:"scatter3d",mode:"lines",x:g.x,y:g.y,z:g.x.map(v=>v===null||v<lowerX||v>upperX?null:floor),line:{color:g.name.startsWith("Inlet")?"#087b76":"#9f5834",width:4},name:g.name,showlegend:false}))];
        const smallFont={size:10};
        layout.scene={xaxis:{title:{text:absolute?"Probe (GHz)":"Detuning (MHz)",font:smallFont},tickfont:smallFont,range:visibleRange},
          yaxis:{title:{text:"Pump (dBm)",font:smallFont},tickfont:smallFont,range},
          zaxis:{title:{text:units[q]},tickfont:smallFont,range:hi>floor?[floor,hi]:undefined},
          aspectmode:"manual",aspectratio:{x:1.23,y:1,z:.72},camera:{eye:{x:1.57,y:1.57,z:1.19}}};
        delete layout.xaxis;delete layout.yaxis;layout.margin={l:4,r:15,b:51,t:39};
      } else {
        traces=[{type:"heatmap",x,y,z,colorscale:palette,zmin:low,zmax:high,colorbar:{title:units[q],thickness:11,len:.82},
           hoverongaps:false,hovertemplate:"%{x:.7g} "+xUnits+"<br>%{y:.3f} dBm<br>%{z:.5g} "+units[q]+"<extra></extra>"},
          {type:"contour",x,y,z,contours:{coloring:"none"},line:{color:"rgba(12,23,37,.42)",width:.55},ncontours:18,showscale:false,hoverinfo:"skip",connectgaps:false},
          ...guides];
        layout.yaxis=axis(pdBm,range);layout.plot_bgcolor="#e8edf1";
        if(hRange) layout.xaxis.range=visibleRange;
        layout.shapes=[vert(toX(0),"#e9f1f2"),cutoff(c.ceiling),cutoff(c.critical)];
        if(c.order!==0) for(const s of [-1,1]) layout.shapes.push(vert(toX(s*c.band_MHz),"#a25731","dash"));
      }
    } else if(current.view==="healing") {
      const values=pumpFrame&&q<2?h.values[q].map(y=>Number.isFinite(y)?y-pumpPhase(c,c.working):null):h.values[q];
      traces=[trace(h.x,values,columns[q],lineColors[q],q===1&&!c.loss?h.values[4]:null)];
      layout.xaxis=axis("Ω / Ωξ",[-5,5]);layout.shapes=[vert(-1,"#087b76","dash"),vert(1,"#087b76","dash")];
    } else if(current.view==="branches") {
      layout=base(q?"Imaginary part of local eigenvalue":"Real part of local eigenvalue",axis("Ω / Ωξ",[-5,5]),axis("N × eigenvalue per cell"),q);
      layout.shapes=[vert(-1,"#087b76","dash"),vert(1,"#087b76","dash")];layout.showlegend=true;layout.legend={orientation:"h",y:1.11};
      traces=[trace(h.x,h.branches[2*q],"Branch +",lineColors[0]),trace(h.x,h.branches[2*q+1],"Branch −",lineColors[1])];
    } else {
      layout.xaxis=axis("Position z / L",[0,1]);layout.showlegend=true;layout.legend={orientation:"h",y:1.11};
      traces=c.evolution.map((v,j)=>{
        const values=v[["phase_pr","phase_id","probe","idler"][q]];
        const y=pumpFrame&&q<2?values.map((x,i)=>Number.isFinite(x)?x-pumpPhase(c,c.working,v.z[i]):null):values;
        return trace(v.z,y,v.detuning_MHz.toFixed(3)+" MHz",lineColors[j],q===1&&!c.loss?v.nodes:null);
      });
    }
    Plotly.react(div,traces,layout,config);
  }
}
let loaded=null;
function plot() {
  if(!loaded) return;
  const c=loaded;
  const p=+$("row").value;
  const di=+$("detuning").value;
  const v=current.view;
  $("title").textContent=views[v];
  $("detail").textContent=c.pump.toFixed(2)+" GHz pump · "+(c.loss?"tan δ = 0.0027":"lossless")+" · "+(c.order===0?"full circuit dispersion":"order "+c.order);
  for (const name of ["row","detuning","zoom","axis","edge","phase","domain"]) {
    const show={row:v==="response",detuning:v==="powercut",zoom:v==="response"||v==="map"||v==="surface",axis:v==="response"||v==="map"||v==="surface",edge:v==="healing"||v==="branches",phase:v!=="branches",domain:v==="map"||v==="surface"}[name];
    $(name+"-label").hidden=!show;
  }
  const focal=v==="healing"||v==="branches"||v==="evolution"?closest(c.power,c.working):p;
  const cut=v==="response"||v==="healing"||v==="branches"||v==="evolution";
  const info=[cut?"Cut "+c.power[focal].toFixed(3)+" dBm":c.power.length+" calculated powers"];
  if(cut) info.push("fξ inlet "+(c.inlet_MHz[focal]?.toFixed(4)??"outside band")+" MHz","fξ outlet "+(c.outlet_MHz[focal]?.toFixed(4)??"outside band")+" MHz");
  if($("phase").value==="pumpframe"&&v!=="branches") info.push("Common pump phase removed");
  if(v==="surface"||v==="map") info.push(c.x.length+" × "+c.power.length+" shared calculation grid");
  if((v==="map"||v==="surface") && $("zoom").value!=="full") {
    const edge=$("zoom").value;
    info.push(edge+" fξ "+c.healing[edge]["fξ_MHz"].toFixed(4)+" MHz at "+c.working.toFixed(3)+" dBm");
  }
  if(c.failures) info.push(c.failures+" unconverged samples omitted");
  if((v==="map"||v==="surface")&&c.freq_seams+c.power_seams>0)
    info.push("phase seams marked where lifts differ");
  info.push("Power ceiling "+c.ceiling.toFixed(2)+" dBm","dispersion band ±"+c.band_MHz.toFixed(3)+" MHz");
  if(v==="response" && c.power[p]>c.ceiling) info.push("formal extrapolation");
  if(v==="response" && $("zoom").value!=="full" && !(($("zoom").value==="inlet"?c.inlet_MHz:c.outlet_MHz)[p])) info.push("healing scale outside band, showing full band");
  $("status").textContent=info.join(" · ");
  render(c,p,di);
}
async function change() {
  const c=selection();if(!c) return;
  const ticket=++current.ticket;
  $("status").textContent="Loading calculated sweep…";
  try {
    const next=await loadCase(c.id);
    if(ticket!==current.ticket) return;
    loaded=next;
    option($("row"),next.power.map((_,i)=>i),i=>next.power[i].toFixed(3)+" dBm"+(next.power[i]>next.ceiling?" (formal)":""));
    $("row").value=closest(next.power,current.power);
    const idx=[...new Set(sampled(next.x.length,161).concat(representativeIndices(next)))].sort((a,b)=>a-b);
    option($("detuning"),idx,i=>next.x[i].toFixed(4)+" MHz");
    $("detuning").value=idx[closest(idx.map(i=>next.x[i]),current.frequency)];
    plot();
  } catch(e) {
    if(ticket===current.ticket) $("status").textContent=e.message;
  }
}
pumps();
$("fit").addEventListener("change",()=>{pumps();change();});
for(const id of ["pump","loss","order"]) $(id).addEventListener("change",change);
$("row").addEventListener("change",()=>{current.power=loaded.power[+$("row").value];plot();});
$("detuning").addEventListener("change",()=>{current.frequency=loaded.x[+$("detuning").value];plot();});
for(const id of ["zoom","axis","edge","phase","domain"]) $(id).addEventListener("change",plot);
document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>{
  current.view=btn.dataset.view;
  document.querySelectorAll("[data-view]").forEach(b=>b.setAttribute("aria-pressed",b===btn));
  plot();
}));
change();

