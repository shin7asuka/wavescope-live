const API = "__PORT_8000__".startsWith("__") ? "http://127.0.0.1:8000" : "__PORT_8000__";
const state = { asset: "gold", interval: "1m", layers: { wave5: true, wave7: true, abc: true }, lastData: null };
const colors = { wave5: "#36d6c7", wave7: "#a988ff", abc: "#f4b84b" };
const names = { wave5: "5浪推动", wave7: "7浪复杂调整", abc: "ABC调整" };

const chartEl = document.getElementById("chart");
const chart = LightweightCharts.createChart(chartEl, {
  autoSize: true,
  layout: { background: { type: "solid", color: "transparent" }, textColor: "#8293a3", fontFamily: "Jet Brains Mono, monospace", fontSize: 11 },
  grid: { vertLines: { color: "rgba(100,130,150,.10)" }, horzLines: { color: "rgba(100,130,150,.10)" } },
  rightPriceScale: { borderColor: "rgba(100,130,150,.18)" },
  timeScale: { borderColor: "rgba(100,130,150,.18)", timeVisible: true, secondsVisible: false, rightOffset: 4 },
  crosshair: { mode: 1, vertLine: { color: "rgba(130,150,170,.35)" }, horzLine: { color: "rgba(130,150,170,.35)" } },
});
const candles = chart.addCandlestickSeries({ upColor: "#51d78b", downColor: "#ff6c78", borderVisible: false, wickUpColor: "#51d78b", wickDownColor: "#ff6c78" });
const waveSeries = {
  wave5: chart.addLineSeries({ color: colors.wave5, lineWidth: 3, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false }),
  wave7: chart.addLineSeries({ color: colors.wave7, lineWidth: 2, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false }),
  abc: chart.addLineSeries({ color: colors.abc, lineWidth: 2, lineStyle: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false }),
};

function ema(values, n) {
  const k = 2 / (n + 1); let x = values[0];
  return values.map((v, i) => x = i ? v * k + x * (1 - k) : v);
}
function atr(bars, n = 14) {
  const tr = bars.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i-1].close), Math.abs(b.low - bars[i-1].close)) : b.high - b.low);
  return ema(tr, n);
}
function pivots(bars, multiplier) {
  if (bars.length < 20) return [];
  const av = atr(bars), out = []; let dir = 0, hi = bars[14].high, lo = bars[14].low, hiI = 14, loI = 14;
  for (let i = 15; i < bars.length; i++) {
    const threshold = multiplier * av[i-1], b = bars[i];
    if (dir === 0) {
      if (b.high > hi) [hi, hiI] = [b.high, i];
      if (b.low < lo) [lo, loI] = [b.low, i];
      if (b.high - lo >= threshold && loI < i) { out.push({ type:"L", value:lo, i:loI, time:bars[loI].time, confirmed:i }); dir=1; [hi,hiI]=[b.high,i]; }
      else if (hi - b.low >= threshold && hiI < i) { out.push({ type:"H", value:hi, i:hiI, time:bars[hiI].time, confirmed:i }); dir=-1; [lo,loI]=[b.low,i]; }
    } else if (dir === 1) {
      if (b.high >= hi) [hi,hiI]=[b.high,i];
      if (hi - b.low >= threshold && hiI < i) { out.push({type:"H",value:hi,i:hiI,time:bars[hiI].time,confirmed:i}); dir=-1; [lo,loI]=[b.low,i]; }
    } else {
      if (b.low <= lo) [lo,loI]=[b.low,i];
      if (b.high - lo >= threshold && loI < i) { out.push({type:"L",value:lo,i:loI,time:bars[loI].time,confirmed:i}); dir=1; [hi,hiI]=[b.high,i]; }
    }
  }
  return out;
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function analyze(bars) {
  const closes = bars.map(b=>b.close), e20=ema(closes,20), e50=ema(closes,50), av=atr(bars);
  const last=closes.at(-1), a=av.at(-1) || 1;
  const trendRaw=(e20.at(-1)-e50.at(-1))/a + (e20.at(-1)-e20.at(-8))/a;
  const trendStrength=Math.min(1,Math.abs(trendRaw)/2.2), direction=trendRaw>=0?1:-1;
  const sets={wave5:pivots(bars,1.15),wave7:pivots(bars,.72),abc:pivots(bars,1.75)};
  const recent5=sets.wave5.slice(-6), recent7=sets.wave7.slice(-8), recentA=sets.abc.slice(-4);
  const hhhl = recent5.length>=4 ? recent5.slice(1).reduce((s,p,i)=>{
    const prev=recent5[i]; return s + ((p.type==="H"&&p.value>prev.value)||(p.type==="L"&&p.value>prev.value)?1:0);
  },0)/(recent5.length-1) : .35;
  const range=Math.max(...bars.slice(-80).map(b=>b.high))-Math.min(...bars.slice(-80).map(b=>b.low));
  const travel=Math.abs(last-closes[Math.max(0,closes.length-80)]);
  const efficiency=range?travel/range:0;
  const density=Math.min(1,sets.wave7.filter(p=>p.i>bars.length-90).length/9);
  const overlap=1-Math.min(1,efficiency);
  const scores={
    wave5:1.0+2.0*trendStrength+1.1*(direction>0?hhhl:1-hhhl)+.6*efficiency,
    wave7:1.0+1.7*density+1.5*overlap+1.0*(1-trendStrength),
    abc:1.0+1.2*(recentA.length>=3?1:.2)+.8*(1-Math.abs(.5-trendStrength)),
  };
  const exp=Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,Math.exp(v)]));
  const total=Object.values(exp).reduce((x,y)=>x+y,0);
  const probs=Object.fromEntries(Object.entries(exp).map(([k,v])=>[k,Math.round(v/total*100)]));
  const diff=100-Object.values(probs).reduce((x,y)=>x+y,0); probs.wave5+=diff;
  const main=Object.keys(probs).sort((x,y)=>probs[y]-probs[x])[0];
  const ps=sets[main], lp=ps.at(-1), prior=ps.at(-2);
  let stage="形成中", stageNo=1;
  if(main==="wave5"){
    const seq=ps.slice(-5).map(p=>p.type).join("");
    if(direction>0){ stageNo=seq.endsWith("LHL")?(last>(prior?.value||last)?3:2):seq.endsWith("LHLHL")?5:(lp?.type==="H"?4:3); }
    else { stageNo=seq.endsWith("HLH")?(last<(prior?.value||last)?3:2):seq.endsWith("HLHLH")?5:(lp?.type==="L"?4:3); }
    stage=`第${stageNo}浪${stageNo===2||stageNo===4?"调整":"推进"}中`;
  } else if(main==="wave7") {
    stageNo=Math.max(1,Math.min(7,ps.length%8||7)); stage=`第${stageNo}段${stageNo===7?"末端确认":"发展"}中`;
  } else {
    stageNo=Math.max(1,Math.min(3,ps.length%4||3)); stage=["A浪调整中","B浪反弹中","C浪完成候选"][stageNo-1];
  }
  const invalidation=lp?.value ?? (direction>0?Math.min(...bars.slice(-20).map(b=>b.low)):Math.max(...bars.slice(-20).map(b=>b.high)));
  const momentum=Math.abs(last-closes.at(-6))/a;
  const paths={};
  Object.entries(sets).forEach(([key,arr])=>{
    const count=key==="wave5"?6:key==="wave7"?8:4;
    paths[key]=arr.slice(-count).map(p=>({time:p.time,value:p.value}));
    paths[key].push({time:bars.at(-1).time,value:last});
  });
  return {probs,main,stage,invalidation,direction,trendStrength,momentum,sets,paths};
}
function fmt(v, asset=state.asset){ return Number(v).toLocaleString("en-US",{minimumFractionDigits:asset==="silver"?3:2,maximumFractionDigits:asset==="silver"?3:2}); }
function render(data) {
  state.lastData=data; const analysis=analyze(data.bars);
  candles.setData(data.bars);
  Object.entries(waveSeries).forEach(([key,series])=>{ series.setData(state.layers[key]?analysis.paths[key]:[]); });
  const markerSets=[
    ...analysis.sets.wave5.slice(-6).map((p,i)=>({time:p.time,position:p.type==="H"?"aboveBar":"belowBar",color:colors.wave5,shape:"circle",text:String(i+1)})),
  ];
  candles.setMarkers(markerSets);
  document.getElementById("assetTitle").textContent=`${data.name} · ${data.code}`;
  document.getElementById("price").textContent=fmt(data.price);
  document.getElementById("unit").textContent=data.unit;
  const d=document.getElementById("delta"), sign=data.change>=0?"+":"";
  d.textContent=`${sign}${fmt(data.change)}  ${sign}${data.changePct.toFixed(2)}%`;
  d.className=`delta ${data.change>0?"up":data.change<0?"down":"flat"}`;
  document.getElementById("primaryWave").textContent=names[analysis.main];
  document.getElementById("primaryStage").textContent=analysis.stage;
  document.getElementById("confidence").textContent=analysis.probs[analysis.main];
  document.getElementById("confidenceBar").style.width=`${analysis.probs[analysis.main]}%`;
  document.getElementById("invalidation").textContent=fmt(analysis.invalidation);
  document.getElementById("trendState").textContent=analysis.direction>0?`偏多 ${Math.round(analysis.trendStrength*100)}%`:`偏空 ${Math.round(analysis.trendStrength*100)}%`;
  document.getElementById("momentumState").textContent=analysis.momentum>1.5?"扩张":analysis.momentum>.7?"中性":"收敛";
  document.getElementById("pivotCount").textContent=analysis.sets.wave7.length;
  document.getElementById("signalText").textContent=`${names[analysis.main]}暂居首位，当前判断为${analysis.stage}。价格若有效越过 ${fmt(analysis.invalidation)}，需重新编号。`;
  document.getElementById("dataTime").textContent=`数据时间 ${new Date(data.dataTime*1000).toLocaleTimeString("zh-CN",{hour12:false})}`;
  document.getElementById("analysisTime").textContent=`分析时间 ${new Date().toLocaleTimeString("zh-CN",{hour12:false})}`;
  document.getElementById("feedStatus").textContent=data.stale?"使用缓存":"行情已连接";
  document.querySelector(".live-chip").classList.toggle("stale",!!data.stale);
  document.getElementById("scenarios").innerHTML=Object.keys(analysis.probs).sort((a,b)=>analysis.probs[b]-analysis.probs[a]).map(key=>
    `<article class="scenario ${key===analysis.main?"primary":""}" style="--scenario-color:${colors[key]}">
      <div class="scenario-head"><span class="scenario-name"><i></i>${names[key]}</span><strong class="scenario-prob">${analysis.probs[key]}%</strong></div>
      <p>${key===analysis.main?analysis.stage:key==="wave7"?"区间重叠与连接浪候选":key==="abc"?"三段式调整备选":"顺势推动备选"}</p>
      <div class="prob-track"><i style="width:${analysis.probs[key]}%"></i></div>
    </article>`).join("");
}
async function refresh(){
  try{
    const r=await fetch(`${API}/api/market/${state.asset}?interval=${state.interval}`,{cache:"no-store"});
    if(!r.ok) throw new Error("行情接口异常");
    const data=await r.json(); if(data.error) throw new Error(data.error); render(data);
  }catch(e){document.getElementById("feedStatus").textContent="正在重连";document.querySelector(".live-chip").classList.add("stale");}
}
document.querySelectorAll(".asset-button").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".asset-button").forEach(x=>x.classList.remove("active"));btn.classList.add("active");state.asset=btn.dataset.asset;refresh();
}));
document.querySelectorAll(".tf").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tf").forEach(x=>x.classList.remove("active"));btn.classList.add("active");state.interval=btn.dataset.interval;refresh().then(()=>chart.timeScale().fitContent());
}));
document.querySelectorAll(".legend-item").forEach(btn=>btn.addEventListener("click",()=>{
  const key=btn.dataset.layer;state.layers[key]=!state.layers[key];btn.classList.toggle("active",state.layers[key]);if(state.lastData)render(state.lastData);
}));
document.querySelector(".theme-toggle").addEventListener("click",()=>{
  const root=document.documentElement;root.dataset.theme=root.dataset.theme==="dark"?"light":"dark";
});
setInterval(()=>document.getElementById("clock").textContent=new Date().toLocaleTimeString("zh-CN",{hour12:false}),1000);
setInterval(refresh,1000);
refresh().then(()=>chart.timeScale().fitContent());
