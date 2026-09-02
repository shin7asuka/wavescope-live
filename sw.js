self.addEventListener("push",event=>{
  let data={title:"WaveScope 价位提醒",body:"目标价已触发",url:"./"};
  try{data={...data,...event.data.json()};}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,
    tag:data.tag||"wavescope-price-alert",
    renotify:true,
    requireInteraction:true,
    vibrate:[500,220,500,700],
    icon:"./icon.svg",
    badge:"./icon.svg",
    data:{url:data.url||"./"},
    actions:[{action:"open",title:"查看行情"},{action:"dismiss",title:"关闭"}]
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  if(event.action==="dismiss") return;
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    if(list.length){list[0].focus();return;}
    return clients.openWindow(event.notification.data?.url||"./");
  }));
});
