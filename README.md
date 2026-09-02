# WaveScope Live

黄金、白银与WTI连续期货的秒级动态浪型分析仪表盘。

## 数据与更新

- 实时口径：TradingView 数据流中的 `OANDA:XAUUSD`、`OANDA:XAGUSD`、`TVC:USOIL`
- 前端每秒请求一次，后端设有0.85秒缓存以控制重复请求
- 1分钟、5分钟、15分钟和1小时周期
- 日K与周K用于观察大级别结构
- 上游报价没有新成交时，分析时间继续更新，但数据时间保持不变
- 分钟与小时图在横向时间轴上标注澳大利亚、日本、中国、德国、英国和美国主要现货交易所的开收盘节点
- 参考核心时段：ASX 10:00–16:00、JPX 09:00–15:30、SSE 09:30–15:00、Xetra 09:00–17:30、LSE 08:00–16:30、NYSE 09:30–16:00，均为当地时间
- 所有节点通过 IANA 时区换算，自动处理澳大利亚、欧洲和美国夏令时；交易所节假日与临时调整不在前端日历中
- 时段核验：[ASX](https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours)、[JPX](https://www.jpx.co.jp/english/systems/equities-trading/index.html)、[SSE](https://english.sse.com.cn/start/trading/schedule/)、[Xetra](https://www.cashmarket.deutsche-boerse.com/cash-en/trading/trading-calendar-and-trading-hours)、[LSE](https://www.londonstockexchange.com/trade/trading-hours)、[NYSE](https://www.nyse.com/trade/hours-calendars)

## 浪型算法

- 使用仅在反转达到ATR阈值后确认的在线ZigZag，避免直接使用未来数据
- 5浪推动、W-X-Y复杂调整、ABC锯齿调整使用不同摆动灵敏度形成候选路径
- 5浪执行艾略特推动浪硬规则：浪2不越起点、浪3越过浪1终点、浪3不得最短、浪4不得进入浪1区域
- ABC按锯齿调整校验；7段按 A-B-C-X-A'-B'-C'（W-X-Y双重锯齿）校验
- 未通过规则的结构会明确降级为候选并显示通过项数，不再直接当作有效浪型
- 已确认浪型从最后一个确认拐点实时延伸至最新价格，并用“实时”箭头标记未确认末端
- 每个阶段明确标注上升或下降方向，图中波段编号带方向箭头
- 根据各浪型摆动高低点、区间边界、斐波那契回撤和扩展动态聚合支撑阻力
- 图中显示S1-S3与R1-R3，每个价位附带启发式强度概率和结构来源
- XAUUSD额外显示4561上沿、4310多空轴与4220下沿；角色会在价格穿越后于支撑/阻力之间动态切换
- 大级别下降带的价位状态与结构评分每秒重算；约800美元指90日主波段振幅，不是4561至4220的341美元带宽
- 新增基于最近180根所选周期K线的线性回归通道，上轨、中轴、下轨均为倾斜线并随行情每秒重算
- 新增日K和周K；大级别约800美元下降结构应优先在日K或周K观察
- 图表标签默认隐藏以减少遮挡；点击图例区“显示标签/隐藏标签”可切换浪号、价格轴和通道标签，线条始终保留
- 切换品种或周期时自动定位到最新K线并重置价格轴；不同周期使用不同可见K线数量，每秒刷新不会打断用户手动缩放
- 概率由趋势强度、摆动密度、重叠度、方向效率和结构完整性经Softmax归一化产生
- 当前概率是启发式结构评分，不是经过历史样本校准的真实概率

## 运行

```bash
python server.py
```

访问 `http://127.0.0.1:8000`。
