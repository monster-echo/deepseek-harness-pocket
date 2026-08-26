// 阻塞等待 ms（maestro 无原生 sleep；runScript 同步执行）
const ms = typeof maestro !== 'undefined' && maestro.sleepMs ? Number(maestro.sleepMs) : 3000
const start = Date.now()
while (Date.now() - start < ms) { /* busy wait */ }
