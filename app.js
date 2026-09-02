const API = "__PORT_8000__".startsWith("__") ? "http://127.0.0.1:8000" : "__PORT_8000__";
const state = { asset: "gold", interval: "1m", layers: { wave5: true, wave7: true, abc: true }, lastData: null };
const colors = { wave5: "#36d6c7", wave7: "#a988ff", abc: "#f4b84b" };
const names = { wave5: "5浪推动", wave7: "W-X-Y复杂调整", abc: "ABC锯齿调整" };

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
let levelPriceLines = [];

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
function macroGoldBand(last,a,sets) {
  const anchors=[
    {key:"upper",price:4561,label:last>=4561?"突破后回踩支撑":"下降带上沿 / 阻力",color:last>=4561?"#51d78b":"#ff7b86"},
    {key:"pivot",price:4310,label:last>=4310?"近端支撑 / 多空轴":"跌破后反压 / 多空轴",color:"#f4b84b"},
    {key:"lower",price:4220,label:last>=4220?"下降带下沿 / 支撑":"跌破后反压",color:last>=4220?"#51d78b":"#ff7b86"},
  ];
  const allPivots=Object.values(sets).flat();
  anchors.forEach(x=>{
    const tolerance=Math.max(6,a*5);
    const hits=allPivots.filter(p=>Math.abs(p.value-x.price)<=tolerance).length;
    const proximity=Math.exp(-Math.abs(last-x.price)/Math.max(90,a*35));
    x.prob=Math.round(Math.min(88,Math.max(28,34+proximity*30+Math.min(20,hits*5))));
  });
  const upper=anchors[0].price,lower=anchors[2].price;
  const position=last>upper?"突破上沿":last<lower?"跌破下沿":`带内 ${Math.round((last-lower)/(upper-lower)*100)}%`;
  return {anchors,upper,lower,width:upper-lower,position,referenceMove:800};
}
function candidateWindows(points, bars, last, count) {
  const windows = [];
  for (let i=Math.max(0,points.length-count-10); i<=points.length-count; i++) {
    if(i>=0) windows.push(points.slice(i,i+count).map(p=>({...p,live:false})));
  }
  if(points.length>=count-1){
    const tail=points.slice(-(count-1));
    const prior=tail.at(-1);
    if(prior){
      const liveType=prior.type==="H"?"L":"H";
      windows.push([...tail,{type:liveType,value:last,i:bars.length-1,time:bars.at(-1).time,confirmed:bars.length-1,live:true}]);
    }
  }
  return windows;
}
function rule(name, pass, hard=true, detail="") { return {name,pass,hard,detail}; }
function validateImpulse(points, direction, a) {
  if(points.length!==6) return {valid:false,score:0,rules:[rule("需要6个边界点",false)]};
  const p=points.map(x=>x.value), expected=direction>0?"LHLHLH":"HLHLHL";
  const types=points.map(x=>x.type).join("");
  const w1=Math.abs(p[1]-p[0]), w3=Math.abs(p[3]-p[2]), w5=Math.abs(p[5]-p[4]);
  const r2=w1?Math.abs(p[2]-p[1])/w1:99, r4=w3?Math.abs(p[4]-p[3])/w3:99;
  const rules=[
    rule("方向交替",types===expected,true,`${types}/${expected}`),
    rule("浪2不越浪1起点",direction>0?p[2]>p[0]:p[2]<p[0],true),
    rule("浪3越过浪1终点",direction>0?p[3]>p[1]:p[3]<p[1],true),
    rule("浪3不是最短推动浪",w3+0.05*a>=Math.min(w1,w5),true),
    rule("浪4不进入浪1价格区",direction>0?p[4]>p[1]:p[4]<p[1],true),
    rule("浪2常见回撤区",r2>=.382&&r2<=.786,false,`${(r2*100).toFixed(1)}%`),
    rule("浪4回撤不过深",r4<=.5,false,`${(r4*100).toFixed(1)}%`),
    rule("浪5测试浪3终点",direction>0?p[5]>=p[3]-.15*a:p[5]<=p[3]+.15*a,false),
  ];
  const hard=rules.filter(x=>x.hard), passed=rules.filter(x=>x.pass).length;
  return {valid:hard.every(x=>x.pass),score:passed/rules.length,rules,points,
    note:rules.filter(x=>x.hard&&!x.pass).map(x=>x.name).join("、")};
}
function validateABC(points, trendDirection) {
  if(points.length!==4) return {valid:false,score:0,rules:[rule("需要4个边界点",false)]};
  const p=points.map(x=>x.value), down=trendDirection>0;
  const expected=down?"HLHL":"LHLH", types=points.map(x=>x.type).join("");
  const rules=[
    rule("A-B-C方向交替",types===expected,true,`${types}/${expected}`),
    rule("B浪不越调整起点",down?p[2]<=p[0]:p[2]>=p[0],true),
    rule("C浪越过A浪终点",down?p[3]<p[1]:p[3]>p[1],true),
    rule("A、C同向",down?(p[1]<p[0]&&p[3]<p[2]):(p[1]>p[0]&&p[3]>p[2]),true),
  ];
  return {valid:rules.every(x=>x.pass),score:rules.filter(x=>x.pass).length/rules.length,rules,points,
    note:rules.filter(x=>!x.pass).map(x=>x.name).join("、")};
}
function validateWXY(points, trendDirection) {
  if(points.length!==8) return {valid:false,score:0,rules:[rule("需要8个边界点",false)]};
  const p=points.map(x=>x.value), down=trendDirection>0;
  const expected=down?"HLHLHLHL":"LHLHLHLH", types=points.map(x=>x.type).join("");
  const rules=[
    rule("7段方向严格交替",types===expected,true,`${types}/${expected}`),
    rule("第一组B不越W起点",down?p[2]<=p[0]:p[2]>=p[0],true),
    rule("第一组C越过A终点",down?p[3]<p[1]:p[3]>p[1],true),
    rule("第二组B不越Y起点",down?p[6]<=p[4]:p[6]>=p[4],true),
    rule("第二组C越过A'终点",down?p[7]<p[5]:p[7]>p[5],true),
    rule("整体方向逆主趋势",down?p[7]<p[0]:p[7]>p[0],true),
  ];
  return {valid:rules.every(x=>x.pass),score:rules.filter(x=>x.pass).length/rules.length,rules,points,
    note:rules.filter(x=>!x.pass).map(x=>x.name).join("、")};
}
function bestValidation(points,bars,last,count,validator) {
  const tested=candidateWindows(points,bars,last,count).map(candidate=>validator(candidate));
  return tested.sort((x,y)=>(Number(y.valid)-Number(x.valid))||(y.score-x.score)||
    ((y.points?.at(-1)?.i||0)-(x.points?.at(-1)?.i||0)))[0] ||
    {valid:false,score:0,rules:[rule(`边界点不足${count}个`,false)],points:[],note:"数据不足"};
}
function buildLevels(sets, probs, bars, last, a, direction) {
  const raw = [];
  const sourceNames={wave5:"5浪摆动",wave7:"7浪边界",abc:"ABC高低点"};
  Object.entries(sets).forEach(([key,arr])=>{
    arr.slice(key==="wave7"?-8:-6).forEach((p,i,list)=>{
      const recency=.58+.42*(i+1)/list.length;
      raw.push({type:p.type==="L"?"support":"resistance",price:p.value,weight:probs[key]*recency*.72,source:sourceNames[key]});
    });
  });
  const window=bars.slice(-100);
  const localLow=Math.min(...window.map(b=>b.low)), localHigh=Math.max(...window.map(b=>b.high));
  raw.push({type:"support",price:localLow,weight:38,source:"近期区间下沿"});
  raw.push({type:"resistance",price:localHigh,weight:38,source:"近期区间上沿"});
  const major=sets.abc.slice(-2);
  if(major.length===2){
    const hi=Math.max(major[0].value,major[1].value),lo=Math.min(major[0].value,major[1].value),span=hi-lo;
    [0.382,0.5,0.618].forEach((r,i)=>{
      const price=direction>0?hi-span*r:lo+span*r;
      raw.push({type:price<=last?"support":"resistance",price,weight:30-i*2,source:`${Math.round(r*1000)/10}%回撤`});
    });
  }
  const lastSwing=sets.wave5.slice(-2);
  if(lastSwing.length===2){
    const span=Math.abs(lastSwing[1].value-lastSwing[0].value);
    const projected=last+direction*span*.618;
    raw.push({type:projected<=last?"support":"resistance",price:projected,weight:probs.wave5*.5,source:"5浪0.618扩展"});
  }
  const filtered=raw.filter(x=>x.price>0&&(x.type==="support"?x.price<=last+a*.18:x.price>=last-a*.18));
  function cluster(type){
    const items=filtered.filter(x=>x.type===type).sort((x,y)=>x.price-y.price), clusters=[];
    items.forEach(item=>{
      const found=clusters.find(c=>Math.abs(c.price-item.price)<=a*.32);
      if(found){
        const oldWeight=found.weight;
        found.price=(found.price*oldWeight+item.price*item.weight)/(oldWeight+item.weight);
        found.weights.push(item.weight);found.weight+=item.weight;found.sources.add(item.source);
      }else clusters.push({price:item.price,weight:item.weight,weights:[item.weight],sources:new Set([item.source])});
    });
    return clusters.map(c=>{
      const combined=1-c.weights.reduce((prod,w)=>prod*(1-Math.min(.9,w/100)),1);
      const distance=Math.abs(c.price-last)/a;
      const relevance=Math.max(.72,1-Math.min(.28,distance*.018));
      return {...c,prob:Math.min(92,Math.round(combined*100*relevance)),source:[...c.sources].slice(0,2).join(" + ")};
    }).sort((x,y)=>type==="support"?y.price-x.price:x.price-y.price).slice(0,3);
  }
  return {support:cluster("support"),resistance:cluster("resistance")};
}
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
  const validations={
    wave5:bestValidation(sets.wave5,bars,last,6,p=>validateImpulse(p,direction,a)),
    wave7:bestValidation(sets.wave7,bars,last,8,p=>validateWXY(p,direction)),
    abc:bestValidation(sets.abc,bars,last,4,p=>validateABC(p,direction)),
  };
  const scores={
    wave5:1.0+2.0*trendStrength+1.1*(direction>0?hhhl:1-hhhl)+.6*efficiency+2.4*(validations.wave5.score-.5)+(validations.wave5.valid?1.2:-1.6),
    wave7:1.0+1.7*density+1.5*overlap+1.0*(1-trendStrength)+2.0*(validations.wave7.score-.5)+(validations.wave7.valid?1.0:-1.4),
    abc:1.0+1.2*(recentA.length>=3?1:.2)+.8*(1-Math.abs(.5-trendStrength))+1.8*(validations.abc.score-.5)+(validations.abc.valid?.8:-1.2),
  };
  const exp=Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,Math.exp(v)]));
  const total=Object.values(exp).reduce((x,y)=>x+y,0);
  const probs=Object.fromEntries(Object.entries(exp).map(([k,v])=>[k,Math.round(v/total*100)]));
  const diff=100-Object.values(probs).reduce((x,y)=>x+y,0); probs.wave5+=diff;
  const main=Object.keys(probs).sort((x,y)=>probs[y]-probs[x])[0];
  const ps=sets[main], lp=ps.at(-1), prior=ps.at(-2);
  let stage="形成中", stageNo=1, legDirection="待确认";
  if(main==="wave5"){
    const selected=validations.wave5.points||[];
    const complete=validations.wave5.valid&&selected.length===6;
    const live=selected.at(-1)?.live;
    const seq=ps.slice(-5).map(p=>p.type).join("");
    if(complete) stageNo=5;
    else if(direction>0){ stageNo=seq.endsWith("LHL")?(last>(prior?.value||last)?3:2):seq.endsWith("LHLHL")?5:(lp?.type==="H"?4:3); }
    else { stageNo=seq.endsWith("HLH")?(last<(prior?.value||last)?3:2):seq.endsWith("HLHLH")?5:(lp?.type==="L"?4:3); }
    const impulseUp=direction>0;
    const legUp=(stageNo%2===1)?impulseUp:!impulseUp;
    legDirection=legUp?"上升":"下降";
    stage=validations.wave5.valid?(complete&&!live?`第5浪完成候选`:`第${stageNo}浪${legDirection}${stageNo===2||stageNo===4?"调整":"推动"}中`):`5浪硬规则未通过：${validations.wave5.note||"边界不足"}`;
  } else if(main==="wave7") {
    const selected=validations.wave7.points||[], complete=validations.wave7.valid&&selected.length===8, live=selected.at(-1)?.live;
    stageNo=complete?7:Math.max(1,Math.min(7,ps.length%8||7));
    const legUp=(stageNo%2===1)?direction<0:direction>0;
    legDirection=legUp?"上升":"下降";
    stage=validations.wave7.valid?(complete&&!live?`W-X-Y第7段完成候选`:`W-X-Y第${stageNo}段${legDirection}${stageNo===7?"末端确认":"调整"}中`):`W-X-Y规则未通过：${validations.wave7.note||"边界不足"}`;
  } else {
    const selected=validations.abc.points||[], complete=validations.abc.valid&&selected.length===4, live=selected.at(-1)?.live;
    stageNo=complete?3:Math.max(1,Math.min(3,ps.length%4||3));
    const legUp=stageNo===2?direction>0:direction<0;
    legDirection=legUp?"上升":"下降";
    stage=validations.abc.valid?(complete&&!live?"C浪完成候选":[`A浪${legDirection}调整中`,`B浪${legDirection}反弹中`,`C浪${legDirection}完成候选`][stageNo-1]):`ABC规则未通过：${validations.abc.note||"边界不足"}`;
  }
  const invalidation=lp?.value ?? (direction>0?Math.min(...bars.slice(-20).map(b=>b.low)):Math.max(...bars.slice(-20).map(b=>b.high)));
  const momentum=Math.abs(last-closes.at(-6))/a;
  const paths={};
  Object.entries(sets).forEach(([key,arr])=>{
    const selected=validations[key].points||[];
    paths[key]=selected.map(p=>({time:p.time,value:p.value}));
  });
  const levels=buildLevels(sets,probs,bars,last,a,direction);
  const macroBand=state.asset==="gold"?macroGoldBand(last,a,sets):null;
  return {probs,main,stage,stageNo,legDirection,invalidation,direction,trendStrength,momentum,sets,paths,levels,validations,macroBand};
}
function fmt(v, asset=state.asset){ return Number(v).toLocaleString("en-US",{minimumFractionDigits:asset==="silver"?3:2,maximumFractionDigits:asset==="silver"?3:2}); }
function render(data) {
  state.lastData=data; const analysis=analyze(data.bars);
  const directionalNames={
    wave5:`${analysis.direction>0?"上升":"下降"}5浪推动`,
    wave7:`${analysis.direction>0?"下降":"上升"}W-X-Y调整`,
    abc:`${analysis.direction>0?"下降":"上升"}ABC锯齿调整`,
  };
  candles.setData(data.bars);
  Object.entries(waveSeries).forEach(([key,series])=>{ series.setData(state.layers[key]?analysis.paths[key]:[]); });
  levelPriceLines.forEach(line=>candles.removePriceLine(line)); levelPriceLines=[];
  analysis.levels.support.forEach((level,i)=>levelPriceLines.push(candles.createPriceLine({
    price:level.price,color:"rgba(81,215,139,.72)",lineWidth:i===0?2:1,lineStyle:i===0?2:1,
    axisLabelVisible:true,title:`S${i+1} ${level.prob}%`,
  })));
  analysis.levels.resistance.forEach((level,i)=>levelPriceLines.push(candles.createPriceLine({
    price:level.price,color:"rgba(255,108,120,.72)",lineWidth:i===0?2:1,lineStyle:i===0?2:1,
    axisLabelVisible:true,title:`R${i+1} ${level.prob}%`,
  })));
  if(analysis.macroBand) analysis.macroBand.anchors.forEach(level=>levelPriceLines.push(candles.createPriceLine({
    price:level.price,color:level.color,lineWidth:2,lineStyle:3,axisLabelVisible:true,
    title:`${level.key==="upper"?"宏观R":level.key==="lower"?"宏观S":"轴"} ${level.prob}%`,
  })));
  const impulsePoints=analysis.validations.wave5.points||[];
  const markerSets=[
    ...impulsePoints.slice(1).map((p,i)=>{
      const n=i+1, up=(n%2===1)?analysis.direction>0:analysis.direction<0;
      return {time:p.time,position:p.type==="H"?"aboveBar":"belowBar",color:colors.wave5,shape:"circle",text:`${n}${up?"↑":"↓"}`};
    }),
  ];
  candles.setMarkers(markerSets);
  document.getElementById("assetTitle").textContent=`${data.name} · ${data.code}`;
  document.getElementById("price").textContent=fmt(data.price);
  document.getElementById("unit").textContent=data.unit;
  const d=document.getElementById("delta"), sign=data.change>=0?"+":"";
  d.textContent=`${data.changeBasis}  ${sign}${fmt(data.change)}  ${sign}${data.changePct.toFixed(2)}%`;
  d.className=`delta ${data.change>0?"up":data.change<0?"down":"flat"}`;
  document.getElementById("primaryWave").textContent=directionalNames[analysis.main];
  document.getElementById("primaryStage").textContent=analysis.stage;
  document.getElementById("confidence").textContent=analysis.probs[analysis.main];
  document.getElementById("confidenceBar").style.width=`${analysis.probs[analysis.main]}%`;
  document.getElementById("invalidation").textContent=fmt(analysis.invalidation);
  document.getElementById("trendState").textContent=analysis.direction>0?`偏多 ${Math.round(analysis.trendStrength*100)}%`:`偏空 ${Math.round(analysis.trendStrength*100)}%`;
  document.getElementById("momentumState").textContent=analysis.momentum>1.5?"扩张":analysis.momentum>.7?"中性":"收敛";
  document.getElementById("pivotCount").textContent=analysis.sets.wave7.length;
  document.getElementById("signalText").textContent=`${directionalNames[analysis.main]}暂居首位，当前判断为${analysis.stage}。价格若有效越过 ${fmt(analysis.invalidation)}，需重新编号。`;
  document.getElementById("dataTime").textContent=`数据时间 ${new Date(data.dataTime*1000).toLocaleTimeString("zh-CN",{hour12:false})}`;
  document.getElementById("analysisTime").textContent=`分析时间 ${new Date().toLocaleTimeString("zh-CN",{hour12:false})}`;
  document.getElementById("feedStatus").textContent=data.stale?"使用缓存":"行情已连接";
  document.querySelector(".live-chip").classList.toggle("stale",!!data.stale);
  document.getElementById("scenarios").innerHTML=Object.keys(analysis.probs).sort((a,b)=>analysis.probs[b]-analysis.probs[a]).map(key=>
    `<article class="scenario ${key===analysis.main?"primary":""}" style="--scenario-color:${colors[key]}">
      <div class="scenario-head"><span class="scenario-name"><i></i>${directionalNames[key]}</span><strong class="scenario-prob">${analysis.probs[key]}%</strong></div>
      <p>${key===analysis.main?analysis.stage:key==="wave7"?`${analysis.direction>0?"下降":"上升"}W-X-Y候选`:key==="abc"?`${analysis.direction>0?"下降":"上升"}ABC锯齿候选`:`${analysis.direction>0?"上升":"下降"}顺势推动候选`} · ${analysis.validations[key].valid?"硬规则通过":"硬规则未通过"} · 质量${analysis.validations[key].rules.filter(r=>r.pass).length}/${analysis.validations[key].rules.length}</p>
      <div class="prob-track"><i style="width:${analysis.probs[key]}%"></i></div>
    </article>`).join("");
  const levelHtml=(levels,type)=>levels.length?levels.map((level,i)=>
    `<div class="level-row" style="--level-color:${type==="support"?"var(--up)":"var(--down)"}">
      <div class="level-top"><span class="level-price">${type==="support"?"S":"R"}${i+1} ${fmt(level.price)}</span><span class="level-prob">${level.prob}%</span></div>
      <span class="level-source">${level.source}</span>
    </div>`).join(""):`<span class="level-source">暂无有效价位</span>`;
  document.getElementById("supportLevels").innerHTML=levelHtml(analysis.levels.support,"support");
  document.getElementById("resistanceLevels").innerHTML=levelHtml(analysis.levels.resistance,"resistance");
  const macroBox=document.getElementById("macroBand");
  macroBox.hidden=!analysis.macroBand;
  if(analysis.macroBand){
    const m=analysis.macroBand;
    document.getElementById("macroRange").textContent=`${fmt(m.lower)} — ${fmt(m.upper)} · 宽 ${fmt(m.width)}`;
    document.getElementById("macroPosition").textContent=m.position;
    document.getElementById("macroLevels").innerHTML=m.anchors.map(x=>`<div class="macro-level" style="--macro-color:${x.color}"><b>${fmt(x.price)}</b><span>${x.label}</span><em>${x.prob}%</em></div>`).join("");
  }
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
