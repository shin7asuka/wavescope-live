const API = "__PORT_8000__".startsWith("__PORT_")
  ? ([location.hostname,"localhost","127.0.0.1"].includes(location.hostname)?"http://127.0.0.1:8000":location.origin)
  : "__PORT_8000__";
const state = { asset: "gold", interval: "1m", displayZone: "beijing", layers: { wave5: true, wave7: true, abc: true }, showLabels: false, showSessions: true, showBollinger: true, lastData: null, needsFocus: true };
const alertAssetNames={gold:"黄金 XAUUSD",silver:"白银 XAGUSD",wti:"WTI USOIL"};
const alertState={rules:[],latest:{},polling:false,alarm:null,audio:null,alarmTimer:null,alarmLoop:null,subscriptionId:null,pushEnabled:false};
const colors = { wave5: "#36d6c7", wave7: "#a988ff", abc: "#f4b84b" };
const names = { wave5: "5浪推动", wave7: "W-X-Y复杂调整", abc: "ABC锯齿调整" };
const displayZones = {
  beijing: { timeZone:"Asia/Shanghai", label:"北京时间", short:"北京" },
  newyork: { timeZone:"America/New_York", label:"美国东部时间", short:"美东" },
};
const zoneFormatters = {
  sydney: new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
  tokyo: new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
  shanghai: new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
  kolkata: new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
  frankfurt: new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
  london: new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
  newyork: new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
};
function epochTime(time){
  return typeof time==="number"?time:Date.UTC(time.year,time.month-1,time.day)/1000;
}
function formatDisplayTime(time, axis=false, seconds=false){
  const date=new Date(epochTime(time)*1000), zone=displayZones[state.displayZone].timeZone;
  const options=["1d","1w"].includes(state.interval)&&axis
    ? {timeZone:zone,month:"2-digit",day:"2-digit"}
    : {timeZone:zone,hour:"2-digit",minute:"2-digit",second:seconds?"2-digit":undefined,hour12:false};
  return new Intl.DateTimeFormat("zh-CN",options).format(date);
}
function formatAxisTick(time,tickMarkType){
  if(tickMarkType<=2) return new Intl.DateTimeFormat("zh-CN",{timeZone:displayZones[state.displayZone].timeZone,month:"2-digit",day:"2-digit"}).format(new Date(epochTime(time)*1000));
  return formatDisplayTime(time,true);
}
function formatDisplayDateTime(time){
  return new Intl.DateTimeFormat("zh-CN",{timeZone:displayZones[state.displayZone].timeZone,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(epochTime(time)*1000));
}

const chartEl = document.getElementById("chart");
const chart = LightweightCharts.createChart(chartEl, {
  autoSize: false,
  width: chartEl.clientWidth,
  height: chartEl.clientHeight,
  layout: { background: { type: "solid", color: "transparent" }, textColor: "#8293a3", fontFamily: "Jet Brains Mono, monospace", fontSize: 11 },
  grid: { vertLines: { color: "rgba(100,130,150,.10)" }, horzLines: { color: "rgba(100,130,150,.10)" } },
  rightPriceScale: { borderColor: "rgba(100,130,150,.18)" },
  timeScale: { borderColor: "rgba(100,130,150,.18)", timeVisible: true, secondsVisible: false, rightOffset: 4, tickMarkFormatter:(time,tickMarkType)=>formatAxisTick(time,tickMarkType) },
  localization: { timeFormatter:time=>`${displayZones[state.displayZone].short} ${formatDisplayTime(time,false)}` },
  crosshair: { mode: 1, vertLine: { color: "rgba(130,150,170,.35)" }, horzLine: { color: "rgba(130,150,170,.35)" } },
});
const sessionAxisEl=document.createElement("div");
sessionAxisEl.id="sessionAxis";
sessionAxisEl.className="session-axis-layer";
sessionAxisEl.setAttribute("aria-label","主要经济体开盘与收盘时间轴");
chartEl.appendChild(sessionAxisEl);
const candles = chart.addCandlestickSeries({ upColor: "#51d78b", downColor: "#ff6c78", borderVisible: false, wickUpColor: "#51d78b", wickDownColor: "#ff6c78" });
const waveSeries = {
  wave5: chart.addLineSeries({ color: colors.wave5, lineWidth: 3, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false }),
  wave7: chart.addLineSeries({ color: colors.wave7, lineWidth: 2, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false }),
  abc: chart.addLineSeries({ color: colors.abc, lineWidth: 2, lineStyle: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false }),
};
const channelSeries = {
  upper: chart.addLineSeries({ color:"#ff7b86",lineWidth:3,lineStyle:2,crosshairMarkerVisible:false,lastValueVisible:true,priceLineVisible:false,title:"动态上轨" }),
  middle: chart.addLineSeries({ color:"rgba(244,184,75,.72)",lineWidth:1,lineStyle:3,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:"通道中轴" }),
  lower: chart.addLineSeries({ color:"#51d78b",lineWidth:3,lineStyle:2,crosshairMarkerVisible:false,lastValueVisible:true,priceLineVisible:false,title:"动态下轨" }),
};
const bollingerSeries = {
  upper: chart.addLineSeries({ color:"rgba(76,151,255,.88)",lineWidth:1,lineStyle:0,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:"布林上轨" }),
  middle: chart.addLineSeries({ color:"rgba(128,164,214,.62)",lineWidth:1,lineStyle:2,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:"布林中轨" }),
  lower: chart.addLineSeries({ color:"rgba(76,151,255,.88)",lineWidth:1,lineStyle:0,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:"布林下轨" }),
};
const futureAxisSeries=chart.addLineSeries({
  color:"transparent",lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:"",
});
let levelPriceLines = [];

function ema(values, n) {
  const k = 2 / (n + 1); let x = values[0];
  return values.map((v, i) => x = i ? v * k + x * (1 - k) : v);
}
function atr(bars, n = 14) {
  const tr = bars.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i-1].close), Math.abs(b.low - bars[i-1].close)) : b.high - b.low);
  return ema(tr, n);
}
function bollingerBands(bars, period=20, multiplier=2){
  const result={upper:[],middle:[],lower:[]};
  if(bars.length<period) return result;
  let sum=0,sumSquares=0;
  for(let i=0;i<bars.length;i++){
    const close=bars[i].close;
    sum+=close;sumSquares+=close*close;
    if(i>=period){
      const old=bars[i-period].close;
      sum-=old;sumSquares-=old*old;
    }
    if(i>=period-1){
      const mean=sum/period;
      const variance=Math.max(0,sumSquares/period-mean*mean);
      const deviation=Math.sqrt(variance)*multiplier;
      result.middle.push({time:bars[i].time,value:mean});
      result.upper.push({time:bars[i].time,value:mean+deviation});
      result.lower.push({time:bars[i].time,value:mean-deviation});
    }
  }
  return result;
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
function anchoredGoldChannel(bars,dailyBars) {
  const startTime=Date.UTC(2026,2,30)/1000;
  const scope=dailyBars.filter(b=>b.time>=startTime);
  if(scope.length<40||!bars.length) return null;
  const earlyEnd=startTime+22*86400;
  const firstPool=scope.filter(b=>b.time<=earlyEnd);
  const first=firstPool.reduce((best,b)=>b.high>best.high?b:best);
  const confirmedHighs=pivots(scope,1.15).filter(p=>p.type==="H"&&p.time>first.time+25*86400);
  const secondPivot=confirmedHighs.at(-1);
  const fallbackPool=scope.filter(b=>b.time>first.time+25*86400&&b.time<scope.at(-1).time);
  const fallback=fallbackPool.length?fallbackPool.reduce((best,b)=>b.high>best.high?b:best):scope.at(-1);
  const second=secondPivot?scope[secondPivot.i]:fallback;
  if(first.time===second.time) return null;
  const slopePerSecond=(second.high-first.high)/(second.time-first.time);
  const base=time=>first.high+slopePerSecond*(time-first.time);
  const liveBars=bars.filter(b=>b.time>=scope.at(-1).time-2*86400);
  const quantile=(values,p)=>{
    const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*p;
    const lower=Math.floor(index),upper=Math.ceil(index);
    return sorted[lower]+(sorted[upper]-sorted[lower])*(index-lower);
  };
  const highResiduals=scope.map(b=>b.high-base(b.time));
  const lowResiduals=scope.map(b=>b.low-base(b.time));
  let highOffset=quantile(highResiduals,.99),lowOffset=quantile(lowResiduals,.06);
  const equilibriumBars=scope.slice(-90);
  const equilibriumCloses=equilibriumBars.map(b=>b.close);
  const live=liveBars.at(-1);
  if(live&&equilibriumCloses.length) equilibriumCloses[equilibriumCloses.length-1]=live.close;
  const centerTarget=equilibriumCloses.reduce((sum,value)=>sum+value,0)/equilibriumCloses.length;
  const rawMiddle=base((live||scope.at(-1)).time)+(highOffset+lowOffset)/2;
  const rawWidth=highOffset-lowOffset;
  const centerShift=Math.max(-rawWidth*.08,Math.min(rawWidth*.08,centerTarget-rawMiddle));
  highOffset+=centerShift;
  lowOffset+=centerShift;
  if(live){
    highOffset=Math.max(highOffset,live.high-base(live.time));
    lowOffset=Math.min(lowOffset,live.low-base(live.time));
  }
  const envelopePad=(atr(scope).at(-1)||0)*.06;
  const upperAt=time=>base(time)+highOffset+envelopePad;
  const lowerAt=time=>base(time)+lowOffset-envelopePad;
  const middleAt=time=>(upperAt(time)+lowerAt(time))/2;
  const projectedBars=bars.filter(b=>b.time>=startTime);
  const firstTime=(projectedBars[0]||bars[0]).time,lastTime=bars.at(-1).time,last=bars.at(-1).close;
  const end={upper:upperAt(lastTime),middle:middleAt(lastTime),lower:lowerAt(lastTime)};
  const start={upper:upperAt(firstTime),middle:middleAt(firstTime),lower:lowerAt(firstTime)};
  const width=end.upper-end.lower,position=Math.max(0,Math.min(100,(last-end.lower)/Math.max(width,.0001)*100));
  const contained=!live||(live.high<=upperAt(live.time)+1e-8&&live.low>=lowerAt(live.time)-1e-8);
  const coverage=(scope.filter(b=>b.high<=upperAt(b.time)&&b.low>=lowerAt(b.time)).length/scope.length)*100;
  return {direction:slopePerSecond<0?"下降":"上升",slope:slopePerSecond,start,end,width,position,contained,
    envelopePad,count:scope.length,anchored:true,anchorStart:startTime,coverage,centerTarget,centerShift,
    anchors:{first:{time:first.time,value:first.high},second:{time:second.time,value:second.high}},
    lines:{
      upper:[{time:firstTime,value:start.upper},{time:lastTime,value:end.upper}],
      middle:[{time:firstTime,value:start.middle},{time:lastTime,value:end.middle}],
      lower:[{time:firstTime,value:start.lower},{time:lastTime,value:end.lower}],
    }};
}
function trendChannel(bars,dailyBars=[]) {
  if(state.asset==="gold"&&dailyBars.length&&["1d","1w"].includes(state.interval)) {
    const anchored=anchoredGoldChannel(bars,dailyBars);
    if(anchored) return anchored;
  }
  const lookback={"1m":180,"5m":180,"15m":180,"1h":120,"4h":120,"1d":90,"1w":26}[state.interval]||180;
  const count=Math.min(lookback,bars.length),sample=bars.slice(-count),n=sample.length;
  if(n<20) return null;
  const meanX=(n-1)/2,meanY=sample.reduce((s,b)=>s+(b.high+b.low+b.close)/3,0)/n;
  let numerator=0,denominator=0;
  sample.forEach((b,i)=>{const dx=i-meanX;numerator+=dx*((b.high+b.low+b.close)/3-meanY);denominator+=dx*dx;});
  const slope=denominator?numerator/denominator:0,intercept=meanY-slope*meanX;
  const highResiduals=sample.map((b,i)=>b.high-(intercept+slope*i));
  const lowResiduals=sample.map((b,i)=>b.low-(intercept+slope*i));
  const channelAtr=atr(sample).at(-1)||0;
  const envelopePad=channelAtr*.06;
  const upperOffset=Math.max(...highResiduals)+envelopePad;
  const lowerOffset=Math.min(...lowResiduals)-envelopePad;
  const at=i=>({middle:intercept+slope*i,upper:intercept+slope*i+upperOffset,lower:intercept+slope*i+lowerOffset});
  const start=at(0),end=at(n-1),last=sample.at(-1).close,width=end.upper-end.lower;
  const position=Math.max(0,Math.min(100,(last-end.lower)/Math.max(width,.0001)*100));
  const totalMove=Math.abs(slope)*(n-1),direction=slope>=0?"上升":"下降";
  const residualScale=Math.max(width/2,.0001);
  const fit=Math.max(0,Math.min(1,1-sample.reduce((s,b,i)=>s+Math.abs(b.close-at(i).middle),0)/n/residualScale));
  const contained=sample.every((b,i)=>b.high<=at(i).upper+1e-8&&b.low>=at(i).lower-1e-8);
  return {direction,slope,start,end,width,position,totalMove,confidence:Math.round(35+fit*50),contained,envelopePad,count,
    lines:{
      upper:[{time:sample[0].time,value:start.upper},{time:sample.at(-1).time,value:end.upper}],
      middle:[{time:sample[0].time,value:start.middle},{time:sample.at(-1).time,value:end.middle}],
      lower:[{time:sample[0].time,value:start.lower},{time:sample.at(-1).time,value:end.lower}],
    }};
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
  const tested=candidateWindows(points,bars,last,count).map(candidate=>{
    const result=validator(candidate), end=candidate.at(-1);
    const age=Math.max(0,bars.length-1-(end?.i||0)), live=!!end?.live;
    const freshness=Math.exp(-age/18);
    return {...result,age,live,freshness,currentScore:result.score+(result.valid?.3:0)-Math.min(.85,age/18)};
  });
  return tested.sort((x,y)=>(y.currentScore-x.currentScore)||(Number(y.valid)-Number(x.valid))||(y.score-x.score))[0] ||
    {valid:false,score:0,rules:[rule(`边界点不足${count}个`,false)],points:[],note:"数据不足"};
}
function normalizePhaseScores(items){
  const total=items.reduce((sum,x)=>sum+x.score,0)||1;
  const rows=items.map(x=>({...x,prob:Math.max(1,Math.round(x.score/total*100))}));
  rows[0].prob+=100-rows.reduce((sum,x)=>sum+x.prob,0);
  return rows.sort((a,b)=>b.prob-a.prob);
}
function buildWave5Phase(validation,points,bars,last,direction,trendStrength,momentum,a){
  const selected=validation.points||[];
  const impulseUp=selected.length?selected[0].type==="L":direction>0;
  const endValue=selected.at(-1)?.value??last;
  const postPivotCount=selected.length===6?points.filter(p=>p.i>selected.at(-1).i).length:0;
  const endpointBroken=selected.length===6&&postPivotCount<2&&(impulseUp?last>endValue+.15*a:last<endValue-.15*a);
  const completed=validation.valid&&!validation.live&&selected.length===6&&!endpointBroken;
  if(completed){
    const postPivots=postPivotCount, age=validation.age||0;
    const sixthDirection=impulseUp?"下降":"上升", seventhDirection=impulseUp?"上升":"下降";
    let items;
    if(postPivots===0) items=[
      {key:"leg6",label:`第6笔 / A浪${sixthDirection}调整`,score:1.7+Math.min(1,age/5)},
      {key:"extend5",label:`第5浪${impulseUp?"上升":"下降"}延伸`,score:1.05*Math.exp(-age/8)+.25},
      {key:"next",label:"直接进入下一浪型",score:.75+.35*trendStrength},
    ];
    else if(postPivots===1) items=[
      {key:"leg7",label:`第7笔 / B浪${seventhDirection}反弹`,score:1.9},
      {key:"leg6",label:`第6笔 / A浪${sixthDirection}延续`,score:.7},
      {key:"next",label:"转入下一浪型",score:.9+.35*trendStrength},
    ];
    else items=[
      {key:"next",label:`下一浪型（C浪${sixthDirection}/新推动）`,score:2.1+Math.min(1,postPivots/4)},
      {key:"leg7",label:`第7笔 / B浪${seventhDirection}延伸`,score:.8},
      {key:"complex",label:"复杂调整延伸",score:1.0+.25*Math.min(2,postPivots)},
    ];
    return {mode:"post5",context:`5浪完成后 ${age} 根K线 · 已确认后续摆动 ${postPivots} 笔`,items:normalizePhaseScores(items)};
  }
  const lp=points.at(-1), currentLegUp=lp?last>=lp.value:direction>0, pushing=currentLegUp===(direction>0);
  const recentSwings=points.filter(p=>p.i>=bars.length-90).length, maturity=Math.min(1,recentSwings/7);
  const up=impulseUp?"上升":"下降", down=impulseUp?"下降":"上升";
  const items=[
    {key:"w1",label:`第1浪（${up}推动）`,score:(pushing?1.05:.32)*(1.25-.75*maturity)},
    {key:"w2",label:`第2浪（${down}调整）`,score:(pushing?.34:1.05)*(1.1-.35*maturity)},
    {key:"w3",label:`第3浪（${up}推动）`,score:(pushing?1.25:.3)*(.65+trendStrength*1.1)},
    {key:"w4",label:`第4浪（${down}调整）`,score:(pushing?.28:1.1)*(.55+maturity*.8)},
    {key:"w5",label:`第5浪（${up}推动）`,score:(pushing?1.0:.3)*(.45+maturity)*(validation.valid&&validation.live?2.2:1)*(momentum<.8?1.2:1)},
  ];
  const normalized=normalizePhaseScores(items);
  return {mode:"forming",context:`${endpointBroken?"原第5浪端点已被越过，按延伸浪重新编号":"5浪尚未确认完成"} · ${pushing?"推动":"回撤"}腿实时评估`,items:normalized};
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
function analyze(bars,macroBars=[]) {
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
  const phaseModel=buildWave5Phase(validations.wave5,sets.wave5,bars,last,direction,trendStrength,Math.abs(last-closes.at(-6))/a,a);
  const scores={
    wave5:1.0+2.0*trendStrength+1.1*(direction>0?hhhl:1-hhhl)+.6*efficiency+2.4*(validations.wave5.score-.5)+(validations.wave5.valid?1.2:-1.6)-Math.min(1.8,(validations.wave5.age||0)/12),
    wave7:1.0+1.7*density+1.5*overlap+1.0*(1-trendStrength)+2.0*(validations.wave7.score-.5)+(validations.wave7.valid?1.0:-1.4)-Math.min(1.5,(validations.wave7.age||0)/15),
    abc:1.0+1.2*(recentA.length>=3?1:.2)+.8*(1-Math.abs(.5-trendStrength))+1.8*(validations.abc.score-.5)+(validations.abc.valid?.8:-1.2)-Math.min(1.5,(validations.abc.age||0)/15),
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
    const complete=validations.wave5.valid&&selected.length===6&&!validations.wave5.live;
    const live=validations.wave5.live;
    const completionAge=validations.wave5.age||0;
    const seq=ps.slice(-5).map(p=>p.type).join("");
    if(complete) stageNo=5;
    else if(direction>0){ stageNo=seq.endsWith("LHL")?(last>(prior?.value||last)?3:2):seq.endsWith("LHLHL")?5:(lp?.type==="H"?4:3); }
    else { stageNo=seq.endsWith("HLH")?(last<(prior?.value||last)?3:2):seq.endsWith("HLHLH")?5:(lp?.type==="L"?4:3); }
    const impulseUp=selected.length?selected[0].type==="L":direction>0;
    const legUp=(stageNo%2===1)?impulseUp:!impulseUp;
    legDirection=legUp?"上升":"下降";
    if(complete&&completionAge<=2) stage=`第5浪刚完成，等待后续K线确认`;
    else if(complete){
      const end=selected.at(-1)?.value??last;
      const postDirection=last<end?"下降":"上升";
      const correcting=impulseUp?last<end:last>end;
      stage=correcting?`5浪已于${completionAge}根K线前完成；当前${postDirection}A浪调整候选`:`价格越过原5浪端点；按延伸浪重新编号`;
      legDirection=postDirection;
    }else if(validations.wave5.valid&&live) stage=`第5浪${legDirection}延伸候选，尚未完成`;
    else stage=`推动结构重编号中；${phaseModel.items[0].label}概率最高`;
  } else if(main==="wave7") {
    const selected=validations.wave7.points||[], complete=validations.wave7.valid&&selected.length===8&&!validations.wave7.live, live=validations.wave7.live, completionAge=validations.wave7.age||0;
    stageNo=complete?7:Math.max(1,Math.min(7,ps.length%8||7));
    const legUp=(stageNo%2===1)?direction<0:direction>0;
    legDirection=legUp?"上升":"下降";
    if(complete&&completionAge<=2) stage="W-X-Y刚完成，等待后续K线确认";
    else if(complete) stage=`W-X-Y已于${completionAge}根K线前完成；当前后续结构重新识别`;
    else if(validations.wave7.valid&&live) stage=`W-X-Y第7段${legDirection}延伸候选，尚未完成`;
    else stage=`W-X-Y规则未通过：${validations.wave7.note||"边界不足"}`;
  } else {
    const selected=validations.abc.points||[], complete=validations.abc.valid&&selected.length===4&&!validations.abc.live, live=validations.abc.live, completionAge=validations.abc.age||0;
    stageNo=complete?3:Math.max(1,Math.min(3,ps.length%4||3));
    const legUp=stageNo===2?direction>0:direction<0;
    legDirection=legUp?"上升":"下降";
    if(complete&&completionAge<=2) stage="ABC刚完成，等待后续K线确认";
    else if(complete) stage=`ABC已于${completionAge}根K线前完成；当前新结构形成中`;
    else if(validations.abc.valid&&live) stage=`C浪${legDirection}延伸候选，尚未完成`;
    else stage=`ABC规则未通过：${validations.abc.note||"边界不足"}`;
  }
  const invalidation=lp?.value ?? (direction>0?Math.min(...bars.slice(-20).map(b=>b.low)):Math.max(...bars.slice(-20).map(b=>b.high)));
  const momentum=Math.abs(last-closes.at(-6))/a;
  const paths={};
  Object.entries(sets).forEach(([key,arr])=>{
    const selected=validations[key].points||[];
    paths[key]=selected.map(p=>({time:p.time,value:p.value}));
    const latest=paths[key].at(-1);
    if(latest&&latest.time<bars.at(-1).time) paths[key].push({time:bars.at(-1).time,value:last});
  });
  const levels=buildLevels(sets,probs,bars,last,a,direction);
  const channel=trendChannel(bars,macroBars);
  const macroChannel=state.asset==="gold"&&macroBars.length?anchoredGoldChannel(bars,macroBars):channel;
  return {probs,main,stage,stageNo,legDirection,invalidation,direction,trendStrength,momentum,sets,paths,levels,validations,channel,macroChannel,phaseModel};
}
function fmt(v, asset=state.asset){ return Number(v).toLocaleString("en-US",{minimumFractionDigits:asset==="silver"?3:2,maximumFractionDigits:asset==="silver"?3:2}); }
function saveAlertRules(){
  return alertState.rules;
}
function urlBase64ToUint8Array(value){
  const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");
  return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
}
async function loadServerRules(){
  if(!alertState.subscriptionId) return;
  try{
    const response=await fetch(`${API}/api/alerts/${alertState.subscriptionId}`,{cache:"no-store"});
    if(response.ok){
      const result=await response.json();
      alertState.rules=(result.alerts||[]).map(rule=>({...rule,enabled:true,triggered:false}));
      renderAlertRules();
    }
  }catch{}
}
async function ensurePushSubscription(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window)) throw new Error("此设备不支持网页推送");
  const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
  if(permission!=="granted") throw new Error("系统通知未获授权");
  const registration=await navigator.serviceWorker.register("./sw.js");
  const configResponse=await fetch(`${API}/api/push/public-key`,{cache:"no-store"});
  const config=await configResponse.json();
  if(!config.enabled||!config.publicKey) throw new Error("服务器推送尚未启用");
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription) subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(config.publicKey)});
  const response=await fetch(`${API}/api/push/subscriptions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(subscription.toJSON())});
  if(!response.ok) throw new Error("保存推送订阅失败");
  const result=await response.json();
  alertState.subscriptionId=result.subscriptionId;
  alertState.pushEnabled=true;
  return result.subscriptionId;
}
async function createServerAlert(rule){
  const subscriptionId=alertState.subscriptionId||await ensurePushSubscription();
  const response=await fetch(`${API}/api/alerts`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subscriptionId,asset:rule.asset,direction:rule.direction,price:rule.price})});
  if(!response.ok) throw new Error((await response.json()).detail||"创建提醒失败");
  return response.json();
}
async function deleteServerAlert(rule){
  if(!alertState.subscriptionId||!rule.id) return;
  try{await fetch(`${API}/api/alerts/${alertState.subscriptionId}/${rule.id}`,{method:"DELETE"});}catch{}
}
function renderAlertRules(){
  document.getElementById("alertCount").textContent=alertState.rules.filter(r=>r.enabled).length;
  document.getElementById("alertRules").innerHTML=alertState.rules.length?alertState.rules.map(rule=>`
    <article class="alert-rule ${rule.triggered?"triggered":""}" data-alert-id="${rule.id}">
      <div><strong>${alertAssetNames[rule.asset]} ${rule.direction==="above"?"≥":"≤"} ${fmt(rule.price,rule.asset)}</strong>
      <span>${rule.triggered?"已触发":"服务器监控中"}${alertState.latest[rule.asset]!=null?` · 最新 ${fmt(alertState.latest[rule.asset],rule.asset)}`:""}</span></div>
      <button class="rule-delete" type="button">删除</button>
    </article>`).join(""):`<div class="alert-empty">暂无提醒。选择品种、方向并输入目标价。</div>`;
  document.querySelectorAll(".alert-rule").forEach(row=>{
    const rule=alertState.rules.find(x=>x.id===row.dataset.alertId);
    row.querySelector(".rule-delete").addEventListener("click",()=>{
      deleteServerAlert(rule);
      alertState.rules=alertState.rules.filter(x=>x.id!==rule.id);saveAlertRules();renderAlertRules();
    });
  });
}
function updateAlertCapability(){
  const notification=("Notification" in window)?Notification.permission:"unsupported";
  document.getElementById("notificationState").textContent=notification==="granted"?"系统通知已授权":notification==="denied"?"系统通知已被阻止":notification==="unsupported"?"此浏览器不支持系统通知":"系统通知尚未授权";
  const parts=[navigator.vibrate?"震动可用":"震动不可用","serviceWorker" in navigator?"系统通知组件可用":"系统通知组件不可用"];
  document.getElementById("alertCapability").textContent=parts.join(" · ");
  document.getElementById("enableNotifications").disabled=notification==="unsupported"||notification==="denied";
  document.getElementById("enableNotifications").textContent=notification==="granted"?"通知已启用":"启用系统通知";
}
async function enableSystemNotifications(){
  if(!("Notification" in window)) return updateAlertCapability();
  try{
    await ensurePushSubscription();
    await loadServerRules();
    document.getElementById("alertCapability").textContent="锁屏 Web Push 已连接 · 服务器每5秒检测";
  }catch(error){document.getElementById("alertCapability").textContent=error.message;}
  updateAlertCapability();
}
function ensureAudio(){
  try{
    alertState.audio=alertState.audio||new (window.AudioContext||window.webkitAudioContext)();
    if(alertState.audio.state==="suspended") alertState.audio.resume();
  }catch{}
}
function alarmSignal(){
  if(navigator.vibrate) navigator.vibrate([500,220,500,700]);
  if(!alertState.audio) return;
  try{
    const now=alertState.audio.currentTime;
    [0,.22,.44].forEach(offset=>{
      const oscillator=alertState.audio.createOscillator(),gain=alertState.audio.createGain();
      oscillator.type="square";oscillator.frequency.value=offset===.44?1040:820;
      gain.gain.setValueAtTime(.0001,now+offset);gain.gain.exponentialRampToValueAtTime(.16,now+offset+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+offset+.16);
      oscillator.connect(gain).connect(alertState.audio.destination);oscillator.start(now+offset);oscillator.stop(now+offset+.18);
    });
  }catch{}
}
async function sendSystemNotification(title,body){
  if(!("Notification" in window)||Notification.permission!=="granted") return;
  const options={body,tag:"wavescope-price-alert",renotify:true,requireInteraction:true,vibrate:[500,220,500,700]};
  try{
    if("serviceWorker" in navigator){
      const registration=await navigator.serviceWorker.ready;
      await registration.showNotification(title,options);
    }else new Notification(title,options);
  }catch{try{new Notification(title,{body,tag:"wavescope-price-alert",requireInteraction:true});}catch{}}
}
function dismissAlarm(){
  clearInterval(alertState.alarmLoop);clearInterval(alertState.alarmTimer);
  alertState.alarmLoop=null;alertState.alarmTimer=null;alertState.alarm=null;
  if(navigator.vibrate) navigator.vibrate(0);
  document.getElementById("alarmOverlay").hidden=true;
}
function startAlarm(rule,current,isTest=false){
  if(alertState.alarm) return;
  ensureAudio();
  const direction=rule.direction==="above"?"上穿":"下破",message=`${alertAssetNames[rule.asset]} 当前 ${fmt(current,rule.asset)}，已${direction}目标 ${fmt(rule.price,rule.asset)}`;
  alertState.alarm={rule,endAt:Date.now()+300000};
  if(!isTest){rule.enabled=false;rule.triggered=true;saveAlertRules();renderAlertRules();}
  document.getElementById("alarmMessage").textContent=isTest?`测试提醒 · ${message}`:message;
  document.getElementById("alarmOverlay").hidden=false;
  alarmSignal();alertState.alarmLoop=setInterval(alarmSignal,2400);
  sendSystemNotification("WaveScope 价位提醒",message);
  const tick=()=>{
    const left=Math.max(0,alertState.alarm.endAt-Date.now()),seconds=Math.ceil(left/1000);
    document.getElementById("alarmCountdown").textContent=`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
    if(left<=0) dismissAlarm();
  };
  tick();alertState.alarmTimer=setInterval(tick,1000);
}
function checkAlertRules(quotes){
  Object.entries(quotes).forEach(([asset,price])=>alertState.latest[asset]=price);
  for(const rule of alertState.rules){
    if(!rule.enabled) continue;
    const current=quotes[rule.asset];if(current==null) continue;
    const previous=rule.lastPrice;
    const crossed=rule.direction==="above"?(previous==null?current>=rule.price:previous<rule.price&&current>=rule.price):(previous==null?current<=rule.price:previous>rule.price&&current<=rule.price);
    rule.lastPrice=current;
    if(crossed){startAlarm(rule,current);break;}
  }
  saveAlertRules();renderAlertRules();
}
async function refreshAlerts(){
  if(alertState.polling||!alertState.rules.some(r=>r.enabled)) return;
  alertState.polling=true;
  try{
    const response=await fetch(`${API}/api/quotes`,{cache:"no-store"});
    if(response.ok){const result=await response.json();checkAlertRules(result.quotes||{});}
  }catch{}finally{alertState.polling=false;}
}
function zonedBar(time, zone){
  const parts=Object.fromEntries(zoneFormatters[zone].formatToParts(new Date(time*1000)).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  return {time,date:`${parts.year}-${parts.month}-${parts.day}`,weekday:parts.weekday,minute:(Number(parts.hour)%24)*60+Number(parts.minute)};
}
function marketSessionEvents(bars){
  if(["1d","1w"].includes(state.interval)||!bars.length) return [];
  const intervalMinutes={"1m":1,"5m":5,"15m":15,"1h":60,"4h":240}[state.interval]||1;
  const first=Math.max(bars[0].time,bars.at(-1).time-30*3600);
  const recent=bars.filter(b=>b.time>=first);
  const weekdays=["Mon","Tue","Wed","Thu","Fri"];
  const rules=[
    {zone:"sydney",minute:10*60,country:"澳",market:"澳大利亚 ASX",open:true,days:weekdays,color:"#e8b44d"},
    {zone:"sydney",minute:16*60,country:"澳",market:"澳大利亚 ASX",open:false,days:weekdays,color:"#e8b44d"},
    {zone:"tokyo",minute:9*60,country:"日",market:"日本 JPX",open:true,days:weekdays,color:"#ff7883"},
    {zone:"tokyo",minute:15*60+30,country:"日",market:"日本 JPX",open:false,days:weekdays,color:"#ff7883"},
    {zone:"shanghai",minute:9*60+30,country:"中",market:"中国 SSE",open:true,days:weekdays,color:"#ff9654"},
    {zone:"shanghai",minute:15*60,country:"中",market:"中国 SSE",open:false,days:weekdays,color:"#ff9654"},
    {zone:"kolkata",minute:9*60+15,country:"印",market:"印度 NSE",open:true,days:weekdays,color:"#ffb357"},
    {zone:"kolkata",minute:15*60+30,country:"印",market:"印度 NSE",open:false,days:weekdays,color:"#ffb357"},
    {zone:"frankfurt",minute:9*60,country:"德",market:"德国 Xetra",open:true,days:weekdays,color:"#7ba6ff"},
    {zone:"frankfurt",minute:17*60+30,country:"德",market:"德国 Xetra",open:false,days:weekdays,color:"#7ba6ff"},
    {zone:"london",minute:8*60,country:"英",market:"英国 LSE",open:true,days:weekdays,color:"#b18cff"},
    {zone:"london",minute:16*60+30,country:"英",market:"英国 LSE",open:false,days:weekdays,color:"#b18cff"},
    {zone:"newyork",minute:9*60+30,country:"美",market:"美国 NYSE",open:true,days:weekdays,color:"#36d6c7"},
    {zone:"newyork",minute:16*60,country:"美",market:"美国 NYSE",open:false,days:weekdays,color:"#36d6c7"},
  ];
  const localized={};
  Object.keys(zoneFormatters).forEach(zone=>localized[zone]=recent.map(b=>zonedBar(b.time,zone)));
  const events=[];
  rules.forEach(rule=>{
    const byDate=new Map();
    localized[rule.zone].forEach(bar=>{
      if(!rule.days.includes(bar.weekday)) return;
      if(!byDate.has(bar.date)) byDate.set(bar.date,[]);
      byDate.get(bar.date).push(bar);
    });
    byDate.forEach(dayBars=>{
      const nearest=dayBars.reduce((best,bar)=>Math.abs(bar.minute-rule.minute)<Math.abs(best.minute-rule.minute)?bar:best);
      if(Math.abs(nearest.minute-rule.minute)<=Math.max(31,intervalMinutes*.6)){
        const hh=String(Math.floor(rule.minute/60)).padStart(2,"0"),mm=String(rule.minute%60).padStart(2,"0");
        events.push({time:nearest.time,text:`${rule.country}${rule.open?"开":"收"}`,market:rule.market,localTime:`${hh}:${mm}`,open:rule.open,color:rule.color});
      }
    });
  });
  return events.sort((a,b)=>a.time-b.time);
}
function drawSessionAxis(bars){
  sessionAxisEl.innerHTML="";
  if(!state.showSessions||["1d","1w"].includes(state.interval)) return;
  const events=marketSessionEvents(bars).map(event=>({...event,x:chart.timeScale().timeToCoordinate(event.time)}))
    .filter(event=>event.x!==null&&event.x>=8&&event.x<=chartEl.clientWidth-64);
  const laneLast=[-999,-999,-999];
  events.forEach(event=>{
    let lane=laneLast.findIndex(last=>event.x-last>=48);
    if(lane<0) lane=laneLast.indexOf(Math.min(...laneLast));
    laneLast[lane]=event.x;
    const el=document.createElement("span");
    el.className=`session-axis-event ${event.open?"open":"close"}`;
    el.style.cssText=`--event-x:${event.x}px;--event-color:${event.color};--event-lane:${lane}`;
    el.textContent=event.text;
    el.title=`${event.market} ${event.open?"开盘":"收盘"} · ${displayZones[state.displayZone].label} ${formatDisplayDateTime(event.time)} · 市场当地 ${event.localTime}`;
    sessionAxisEl.appendChild(el);
  });
}
function futureAxisPoints(bars){
  if(!bars.length)return [];
  const last=bars.at(-1).time;
  if(state.interval==="1d") return [{time:last+86400}];
  if(state.interval==="1w") return [{time:last+7*86400}];
  const slots=16,step=4*3600/slots;
  return Array.from({length:slots},(_,i)=>({time:last+Math.round(step*(i+1))}));
}
function focusLatest(bars){
  const visibleByInterval={ "1m":150,"5m":160,"15m":170,"1h":150,"4h":140,"1d":180,"1w":156 };
  const widthFactor=chartEl.clientWidth<600?.52:chartEl.clientWidth<900?.78:1;
  const visible=Math.min(bars.length,Math.max(55,Math.round((visibleByInterval[state.interval]||160)*widthFactor)));
  const futureSlots=futureAxisPoints(bars).length;
  chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-visible)-.5,to:bars.length-1+futureSlots+.5});
  chart.priceScale("right").applyOptions({autoScale:true,scaleMargins:{top:.08,bottom:.12}});
  state.needsFocus=false;
}
function render(data) {
  state.lastData=data; const analysis=analyze(data.bars,data.macroBars||[]);
  const bollinger=bollingerBands(data.bars);
  const directionalNames={
    wave5:`${analysis.direction>0?"上升":"下降"}5浪推动`,
    wave7:`${analysis.direction>0?"下降":"上升"}W-X-Y调整`,
    abc:`${analysis.direction>0?"下降":"上升"}ABC锯齿调整`,
  };
  candles.setData(data.bars);
  futureAxisSeries.setData(futureAxisPoints(data.bars));
  Object.entries(waveSeries).forEach(([key,series])=>{ series.setData(state.layers[key]?analysis.paths[key]:[]); });
  Object.entries(channelSeries).forEach(([key,series])=>{
    const titles={upper:"动态上轨",middle:"通道中轴",lower:"动态下轨"};
    series.applyOptions({lastValueVisible:state.showLabels&&key!=="middle",title:state.showLabels?titles[key]:""});
    series.setData(analysis.channel?analysis.channel.lines[key]:[]);
  });
  Object.entries(bollingerSeries).forEach(([key,series])=>{
    series.setData(state.showBollinger?bollinger[key]:[]);
  });
  levelPriceLines.forEach(line=>candles.removePriceLine(line)); levelPriceLines=[];
  analysis.levels.support.forEach((level,i)=>levelPriceLines.push(candles.createPriceLine({
    price:level.price,color:"rgba(81,215,139,.72)",lineWidth:i===0?2:1,lineStyle:i===0?2:1,
    axisLabelVisible:state.showLabels,title:state.showLabels?`S${i+1} ${level.prob}%`:"",
  })));
  analysis.levels.resistance.forEach((level,i)=>levelPriceLines.push(candles.createPriceLine({
    price:level.price,color:"rgba(255,108,120,.72)",lineWidth:i===0?2:1,lineStyle:i===0?2:1,
    axisLabelVisible:state.showLabels,title:state.showLabels?`R${i+1} ${level.prob}%`:"",
  })));
  const impulsePoints=analysis.validations.wave5.points||[];
  const markerSets=[
    ...impulsePoints.slice(1).map((p,i)=>{
      const n=i+1, up=(n%2===1)?analysis.direction>0:analysis.direction<0;
      return {time:p.time,position:p.type==="H"?"aboveBar":"belowBar",color:colors.wave5,shape:"circle",text:`${n}${up?"↑":"↓"}`};
    }),
    {time:data.bars.at(-1).time,position:data.change>=0?"belowBar":"aboveBar",color:colors[analysis.main],shape:data.change>=0?"arrowUp":"arrowDown",text:"实时"},
  ];
  candles.setMarkers(state.showLabels?markerSets:[]);
  drawSessionAxis(data.bars);
  const sessionToggle=document.getElementById("sessionToggle");
  const intraday=!["1d","1w"].includes(state.interval);
  sessionToggle.disabled=!intraday;
  sessionToggle.classList.toggle("unavailable",!intraday);
  document.getElementById("sessionRef").textContent=intraday?"国家时段 澳 · 日 · 中 · 印 · 德 · 英 · 美":"日K/周K不显示日内时段";
  const horizonSeconds=state.interval==="1w"?7*86400:state.interval==="1d"?86400:4*3600;
  const horizonLabel=state.interval==="1w"?"+1周":state.interval==="1d"?"+1日":"+4小时";
  document.getElementById("futureHorizon").textContent=`未来轴至 ${displayZones[state.displayZone].short} ${formatDisplayTime(data.bars.at(-1).time+horizonSeconds,false)}（${horizonLabel}）`;
  document.querySelector("#channelLegend span").textContent=state.asset==="gold"&&["1d","1w"].includes(state.interval)?"长期趋势带":"局部趋势带";
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
  document.getElementById("dataTime").textContent=`数据时间 ${formatDisplayTime(data.dataTime,false,true)}`;
  document.getElementById("analysisTime").textContent=`分析时间 ${formatDisplayTime(Date.now()/1000,false,true)}`;
  document.getElementById("feedStatus").textContent=data.stale?"使用缓存":"行情已连接";
  document.querySelector(".live-chip").classList.toggle("stale",!!data.stale);
  document.getElementById("scenarios").innerHTML=Object.keys(analysis.probs).sort((a,b)=>analysis.probs[b]-analysis.probs[a]).map(key=>
    `<article class="scenario ${key===analysis.main?"primary":""}" style="--scenario-color:${colors[key]}">
      <div class="scenario-head"><span class="scenario-name"><i></i>${directionalNames[key]}</span><strong class="scenario-prob">${analysis.probs[key]}%</strong></div>
      <p>${key===analysis.main?analysis.stage:key==="wave7"?`${analysis.direction>0?"下降":"上升"}W-X-Y候选`:key==="abc"?`${analysis.direction>0?"下降":"上升"}ABC锯齿候选`:`${analysis.direction>0?"上升":"下降"}顺势推动候选`} · ${analysis.validations[key].valid?"硬规则通过":"硬规则未通过"} · 质量${analysis.validations[key].rules.filter(r=>r.pass).length}/${analysis.validations[key].rules.length}</p>
      <div class="prob-track"><i style="width:${analysis.probs[key]}%"></i></div>
    </article>`).join("");
  document.getElementById("phaseContext").textContent=analysis.phaseModel.context;
  document.getElementById("phaseProbabilities").innerHTML=analysis.phaseModel.items.map((item,i)=>
    `<div class="phase-row ${i===0?"primary":""}">
      <span>${item.label}</span><div class="phase-track"><i style="width:${item.prob}%"></i></div><strong>${item.prob}%</strong>
    </div>`).join("");
  const levelHtml=(levels,type)=>levels.length?levels.map((level,i)=>
    `<div class="level-row" style="--level-color:${type==="support"?"var(--up)":"var(--down)"}">
      <div class="level-top"><span class="level-price">${type==="support"?"S":"R"}${i+1} ${fmt(level.price)}</span><span class="level-prob">${level.prob}%</span></div>
      <span class="level-source">${level.source}</span>
    </div>`).join(""):`<span class="level-source">暂无有效价位</span>`;
  document.getElementById("supportLevels").innerHTML=levelHtml(analysis.levels.support,"support");
  document.getElementById("resistanceLevels").innerHTML=levelHtml(analysis.levels.resistance,"resistance");
  const macroBox=document.getElementById("macroBand");
  macroBox.hidden=state.asset!=="gold"||!analysis.macroChannel;
  if(!macroBox.hidden){
    const c=analysis.macroChannel;
    document.getElementById("macroRange").textContent=`${c.direction}${c.anchored?"动态锚定":"包络"}通道 ${fmt(c.end.lower)} — ${fmt(c.end.upper)}`;
    document.getElementById("macroPosition").textContent=`中轴 ${fmt(c.end.middle)} · 带内 ${Math.round(c.position)}% · ${c.anchored?`90日均衡 ${fmt(c.centerTarget)} · 覆盖${Math.round(c.coverage)}%`:"完整包络"}`;
  }
  if(state.needsFocus) requestAnimationFrame(()=>focusLatest(data.bars));
}
async function refresh(){
  try{
    const r=await fetch(`${API}/api/market/${state.asset}?interval=${state.interval}`,{cache:"no-store"});
    if(!r.ok) throw new Error("行情接口异常");
    const data=await r.json(); if(data.error) throw new Error(data.error); render(data);
  }catch(e){document.getElementById("feedStatus").textContent="正在重连";document.querySelector(".live-chip").classList.add("stale");}
}
document.querySelectorAll(".asset-button").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".asset-button").forEach(x=>x.classList.remove("active"));btn.classList.add("active");state.asset=btn.dataset.asset;state.needsFocus=true;refresh();
}));
document.querySelectorAll(".tf").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tf").forEach(x=>x.classList.remove("active"));btn.classList.add("active");state.interval=btn.dataset.interval;state.needsFocus=true;
  if(["1d","1w"].includes(state.interval)) sessionAxisEl.innerHTML="";
  refresh();
}));
document.querySelectorAll(".legend-item").forEach(btn=>btn.addEventListener("click",()=>{
  const key=btn.dataset.layer;if(!key)return;state.layers[key]=!state.layers[key];btn.classList.toggle("active",state.layers[key]);if(state.lastData)render(state.lastData);
}));
document.getElementById("labelToggle").addEventListener("click",e=>{
  state.showLabels=!state.showLabels;
  const btn=e.currentTarget;btn.classList.toggle("active",state.showLabels);
  btn.querySelector("span").textContent=state.showLabels?"隐藏标签":"显示标签";
  if(state.lastData)render(state.lastData);
});
document.getElementById("sessionToggle").addEventListener("click",e=>{
  state.showSessions=!state.showSessions;
  const btn=e.currentTarget;btn.classList.toggle("active",state.showSessions);
  btn.querySelector("span").textContent=state.showSessions?"隐藏国家时段":"显示国家时段";
  if(state.lastData)render(state.lastData);
});
document.getElementById("bollingerToggle").addEventListener("click",e=>{
  state.showBollinger=!state.showBollinger;
  const btn=e.currentTarget;btn.classList.toggle("active",state.showBollinger);
  btn.querySelector("span").textContent=state.showBollinger?"隐藏布林带":"显示布林带";
  if(state.lastData) render(state.lastData);
});
document.querySelectorAll(".zone-button").forEach(btn=>btn.addEventListener("click",()=>{
  state.displayZone=btn.dataset.zone;
  document.querySelectorAll(".zone-button").forEach(x=>x.classList.toggle("active",x===btn));
  chart.applyOptions({localization:{timeFormatter:time=>`${displayZones[state.displayZone].short} ${formatDisplayTime(time,false)}`}});
  chart.timeScale().applyOptions({tickMarkFormatter:(time,tickMarkType)=>formatAxisTick(time,tickMarkType)});
  if(state.lastData) render(state.lastData);
  updateClock();
}));
chart.timeScale().subscribeVisibleLogicalRangeChange(()=>state.lastData&&requestAnimationFrame(()=>drawSessionAxis(state.lastData.bars)));
let viewportFocusTimer;
new ResizeObserver(entries=>{
  const box=entries[0]?.contentRect;
  if(box?.width&&box?.height) chart.resize(box.width,box.height);
  if(!state.lastData)return;
  requestAnimationFrame(()=>drawSessionAxis(state.lastData.bars));
  clearTimeout(viewportFocusTimer);
  viewportFocusTimer=setTimeout(()=>{
    state.needsFocus=true;
    focusLatest(state.lastData.bars);
  },140);
}).observe(chartEl);
const landscapePhone=matchMedia("(max-width: 1000px) and (max-height: 600px) and (min-aspect-ratio: 4/3)");
function refitAfterRotation(){
  scrollTo(0,0);
  if(!state.lastData)return;
  state.needsFocus=true;
  requestAnimationFrame(()=>focusLatest(state.lastData.bars));
}
landscapePhone.addEventListener?.("change",()=>setTimeout(refitAfterRotation,160));
addEventListener("orientationchange",()=>setTimeout(refitAfterRotation,220));
screen.orientation?.addEventListener?.("change",()=>setTimeout(refitAfterRotation,220));
visualViewport?.addEventListener?.("resize",()=>setTimeout(refitAfterRotation,120));
addEventListener("pageshow",()=>setTimeout(refitAfterRotation,120));
document.querySelector(".theme-toggle").addEventListener("click",()=>{
  const root=document.documentElement;root.dataset.theme=root.dataset.theme==="dark"?"light":"dark";
});
document.getElementById("alertLauncher").addEventListener("click",()=>{
  document.getElementById("alertAsset").value=state.asset;
  if(state.lastData) document.getElementById("alertPrice").value=state.lastData.price;
  document.getElementById("alertModal").hidden=false;updateAlertCapability();renderAlertRules();
});
document.getElementById("alertClose").addEventListener("click",()=>document.getElementById("alertModal").hidden=true);
document.getElementById("alertModal").addEventListener("click",event=>{if(event.target.id==="alertModal") event.currentTarget.hidden=true;});
document.getElementById("enableNotifications").addEventListener("click",enableSystemNotifications);
document.getElementById("alertForm").addEventListener("submit",async event=>{
  event.preventDefault();ensureAudio();
  const asset=document.getElementById("alertAsset").value,direction=document.getElementById("alertDirection").value,price=Number(document.getElementById("alertPrice").value);
  if(!Number.isFinite(price)||price<=0) return;
  const button=event.submitter;button.disabled=true;button.textContent="正在创建";
  try{
    const created=await createServerAlert({asset,direction,price});
    alertState.rules.push({id:created.id,asset,direction,price,enabled:true,triggered:false,lastPrice:alertState.latest[asset]??null});
    saveAlertRules();renderAlertRules();refreshAlerts();document.getElementById("alertPrice").value="";
  }catch(error){document.getElementById("alertCapability").textContent=error.message;}
  finally{button.disabled=false;button.textContent="添加提醒";}
});
document.getElementById("testAlert").addEventListener("click",()=>{
  ensureAudio();const asset=document.getElementById("alertAsset").value,current=alertState.latest[asset]??state.lastData?.price??0;
  startAlarm({asset,direction:"above",price:current},current,true);
});
document.getElementById("dismissAlarm").addEventListener("click",dismissAlarm);
document.addEventListener("keydown",event=>{if(event.key==="Escape"){if(alertState.alarm)dismissAlarm();else document.getElementById("alertModal").hidden=true;}});
function updateClock(){document.getElementById("clock").textContent=`${displayZones[state.displayZone].short} ${formatDisplayTime(Date.now()/1000,false,true)}`;}
setInterval(updateClock,1000);
setInterval(refresh,1000);
setInterval(refreshAlerts,1000);
renderAlertRules();
updateAlertCapability();
if("Notification" in window&&Notification.permission==="granted") ensurePushSubscription().then(loadServerRules).catch(()=>{});
updateClock();
refresh();
