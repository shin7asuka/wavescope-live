self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    if(list.length){list[0].focus();return;}
    return clients.openWindow("./");
  }));
});
