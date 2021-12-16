const express = require('express');
const _ = require("lodash")
const WebSocket = require("ws")
const {httpsServer} = require("../server")
const moment = require("moment")
const router = express.Router();
const voteIdMapWs = {}
const wss = new WebSocket.Server({ server: httpsServer })

wss.on('connection', async (ws, req) => {
    let voteId = req.url.split('/').slice(-1)[0]
    let voteInfo = await db.get('SELECT * FROM votes WHERE rowid = ?', voteId)
    if ((!voteInfo) || Date.now() > new Date(voteInfo.deadline).getTime()) {
        ws.close()
    }

    if (voteId in voteIdMapWs) {
        voteIdMapWs[voteId].push(ws)
    } else {
        voteIdMapWs[voteId] = [ws]
    }
    let id = Math.random().toString(16).slice(2)
    ws.on('message', (data) => {
        ws.send(JSON.stringify({ id }))
        ws.id = id
    })

    ws.on('close', () => {
        voteIdMapWs[voteId] = voteIdMapWs[voteId].filter(it => it !== ws)
    })
})

router.get("/display-vote", async (req, res, next) => {
    try {
        const displayVoteID = [1, 2]
        const result = []
        for (let voteID of displayVoteID) {
            const { title } = await db.get(`
            SELECT title
            FROM votes
            WHERE votes.rowid = ?
        `, voteID)
            const options = await db.all(`
            SELECT optionID, COUNT(*) as voteups, content 
            FROM votings JOIN options ON votings.optionID = options.rowid WHERE votings.voteID = ?
            GROUP BY optionID LIMIT 4
        `, voteID)

            const { numberOfUsers } = await db.get(`
            SELECT COUNT(distinct userID) as numberOfUsers FROM votings WHERE voteID = ? 
        `, voteID)
            result.push({ title, options, numberOfUsers, voteID })
        }

        res.status(200).json(result).end()
    } catch (e) {
        res.status(400).json({
            code: -1,
            msg: "展示投票信息配置错误"
        })
    }
})


router.post("/myvote", async (req, res, next) => {
    if (!req.curUser || req.curUser.name !== req.body.userInfo?.name) {
        res.status(401).json({
            code: -2,
            msg: "用户状态错误"
        }).end()
        return
    } else {
        let createVoteList = await db.all(`
            SELECT votes.anonymous, votes.title, votes.createdAt, votes.rowid as voteID, users.name, users.avatar FROM votes
            JOIN users
            ON users.rowid = votes.userID
            where votes.userID = ?
        `, req.curUser.ID)
        let participateVoteList = await db.all(`
        select distinct votings.voteID, votes.anonymous, votes.createdAt, votes.title, users.name, users.avatar
        from votings 
        JOIN votes 
        on votes.rowid= voteID 
        JOIN users
        on users.rowid = votes.userID
        where votings.userID = ?;
        `, req.curUser.ID)
        res.json({
            code: 0,
            msg: "投票列表获取成功",
            voteList: {
                create: createVoteList.map(it => it.anonymous === 1 ? { ...it, name: "", avatar: "/uploads/default.png" } : it),
                participate: participateVoteList.map(it => it.anonymous === 1 ? { ...it, name: "", avatar: "/uploads/default.png" } : it),
            },
        }).end()
    }
})


async function getVoteInfo(voteID) {
    let vote = await db.get(`
        SELECT *
        FROM votes 
        WHERE votes.rowid = ?
    `, voteID)
    if (!vote.anonymous) {
        var creator = await db.get(`
            SELECT users.name 
            FROM users
            WHERE users.rowid = ?
        `, vote.userID)
    }
    vote = { ...vote, creator: vote.anonymous ? "" : creator.name }
    delete vote.createdAt
    delete vote.userID
    let options = await db.all(`
        SELECT *, rowid as optionID FROM options
        WHERE options.voteID = ?
    `, voteID)

    let votings = await db.all(`
        SELECT voteID, optionID, userID, users.name, users.avatar FROM votings
        JOIN users
        ON votings.userID = users.rowid
        WHERE votings.voteID = ?
    `, voteID)

    return { vote, options, votings }
}

router.route("/normal/:voteID")
    //GET: 投票详情
    .get(async (req, res, next) => {
        try {
            var voteInfo = await getVoteInfo(req.params.voteID)
            res.status(200).json({
                code: 0,
                msg: "获取投票信息成功",
                voteInfo,
            }).end()
        } catch (e) {
            res.status(400).json({
                code: -1,
                msg: "获取投票信息失败"
            }).end()
        }
    })


//POST: 发起投票
router.route("/create")
    .post(async (req, res, next) => {
        if (!req.curUser || req.curUser.name !== req.body.userInfo?.name) {
            res.status(401).json({
                code: -2,
                msg: "用户状态错误",
                userInfo: req.curUser
            }).end()
            return
        }
        let vote = req.body
        try {
            let action = await db.run(
                `INSERT INTO votes VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [vote.title, vote.desc, req.curUser.ID, vote.isAnonymous, vote.isMultiple, moment().locale('zh-cn').format('YYYY-MM-DD HH:mm:ss'), vote.deadline]
            )
            for (option of vote.options) {
                await db.run(
                    `INSERT INTO options VALUES (?, ?)`,
                    [action.lastID, option]
                )
            }
            res.json({
                code: 0,
                msg: "发起投票成功",
                voteID: action.lastID,
            })
        } catch (e) {
            res.status(400).json({
                code: -1,
                msg: e.toString(),
            })
        }
    })

//POST: 完成投票
router.route("/voteup")
    .post(async (req, res, next) => {
        if (!req.curUser || req.curUser.name !== req.body.userInfo?.name) {
            res.status(401).json({
                code: -2,
                msg: "用户状态错误"
            })
            return
        }
        try {
            let vote = await db.get(`
            SELECT * 
            FROM votes 
            WHERE votes.rowid = ?
            `, req.body.voteID)
            if (Date.now() > new Date(vote.deadline).getTime()) {
                res.status(400).json({
                    code: -1,
                    msg: "投票超时"
                })
                return
            }

            let isVoted = await db.get(`
                select * from votings
                where voteID = ? and optionID = ? and userID = ?
            `, req.body.voteID, req.body.optionID, req.curUser.ID)
            if (isVoted) {
                await db.run(`
                    DELETE FROM votings 
                    WHERE voteID = ? AND optionID = ? AND userID = ?
                `, req.body.voteID, req.body.optionID, req.curUser.ID)
            } else {
                if (!vote.isMultiple) {
                    await db.run(`
                    DELETE FROM votings 
                    WHERE voteID = ? AND userID = ?
                `, req.body.voteID, req.curUser.ID)
                }
                await db.run(`
                    INSERT INTO votings VALUES (?, ?, ?)
                `, req.body.voteID, req.body.optionID, req.curUser.ID)
            }
            if (!(req.body.voteID in broadcasSubs)) {
                broadcasSubs[req.body.voteID] = broadcast(req.body.voteID)
            }
            broadcasSubs[req.body.voteID](req.body.webSocketID)
            res.end()
        } catch (e) {
            res.status(400).json({
                code: -1,
                msg: "投票失败"
            })
            return
        }

    })

let broadcasSubs = {} //订阅播发
let broadcast = function (voteID) {
    return _.throttle(async function (webSocketID) {
        let websocket = voteIdMapWs[voteID] || []
        let votings = await db.all(`
        SELECT voteID, optionID, userID, users.name, users.avatar FROM votings
        JOIN users
        ON votings.userID = users.rowid
        WHERE votings.voteID = ?
    `, voteID)
        for (ws of websocket) {
            if (ws.id !== webSocketID) {
                ws.send(JSON.stringify(votings))
            }
        }
    }, 2000, { leading: false })
}


module.exports = router;