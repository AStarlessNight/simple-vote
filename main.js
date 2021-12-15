const express = require("express")
const { server } = require("./server")
const cookieParser = require("cookie-parser")
const dbPromise = require("./database")
const path = require("path")
dbPromise.then(value => {
    console.log("database loaded")
    global.db = value
})



//通用中间键
; (function commonMiddleware() {
    //react-app
    server.use(express.static("./build"))
    //处理图片请求
    server.use(express.static("./static/img/"))
    //处理json
    server.use(express.json())
    //处理url编码请求
    server.use(express.urlencoded({ extended: true }))
    server.use(cookieParser("laskdjiqwe937z09"))
})()

const sessionStore = Object.create(null)
server.use(async (req, res, next) => {
    if (req.signedCookies.sessionID) {
        req.session = sessionStore[req.signedCookies.sessionID]

        if (!req.session) {
            req.session = sessionStore[req.signedCookies.sessionID] = {}
        }
    } else {

        let sessionID = Math.random().toString(16).slice(2)
        req.session = sessionStore[sessionID] = {}
        res.cookie("sessionID", sessionID, {
            signed: true,
            maxAge: 86400000,
        })
    }
    req.curUser = await db.get(`
        select *, rowid as ID from users where users.name = ?
    `, req.signedCookies.user)
    next()
})

server.use("/api", require("./routes/api"))




server.use(function (req, res, next) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});


