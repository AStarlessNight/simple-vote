const express = require("express")
const http = require("http")
const server = express() //服务器
const https = require("https")
const fs = require("fs")
http.createServer((req, res) => {
    res.writeHead(302, {"Location": `https://starless.top${req.url}`}).end()
}).listen(80)
const httpsServer = https.createServer({
    key: fs.readFileSync("/root/.acme.sh/starless.top/starless.top.key"),
    cert: fs.readFileSync("/root/.acme.sh/starless.top/starless.top.cer")
},server).listen(443)



module.exports = {server, httpsServer} 