const express = require('express');
const multer = require('multer');
const path = require("path")
const nodeMailer = require("nodemailer")
const router = express.Router();
const pwdMap = Object.create(null)
const moment = require("moment")
console.log(moment().locale('zh-cn').format('YYYY-MM-DD HH:mm:ss'))

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './static/img/uploads/')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Math.random().toString(36).slice(2)
        cb(null, uniqueSuffix + '.' + file.mimetype.slice(6))
    }
})
const fileFilter = function (req, file, cb) {
    try {
        registerPrecheck(req.session, req.body)
    } catch (e) {
        cb(e)
        return
    }
    req.registerPrecheck = true
    if (/^image\//.test(file.mimetype)) {
        cb(null, true)
    } else {
        cb(new Error("文件类型错误"))
    }
}

const registerPrecheck = function (session, userInfo) {
    if (!session.captcha.test(userInfo.captcha)) {
        throw (new Error("验证码错误"))
    }
    if (userInfo.username.length > 10) {
        throw (new Error("超出用户名长度限制"))
    }
    if (!userInfo.username || !userInfo.password) {
        throw (new Error("用户名或密码不能为空"))
    }
    if (userInfo.password !== userInfo.confirm) {
        throw (new Error("两次输入密码不一致"))
    }
}

const uploader = multer({ storage, fileFilter, limits: { fileSize: 1 * 1024 * 1024 } })
const upload = uploader.single("avatar")

let transporter = nodeMailer.createTransport({
    service: 'smtp.163.com',
    host: "smtp.163.com",
    secure: true,
    port: 465,
    auth: {
        user: 'testmyvote@163.com',
        pass: 'TUYGXHWCTFPACPQX',
    }
});

router.get("/userInfo", async (req, res, next) => {
    if (req.curUser) {
        res.json({
            code: 0,
            msg: "用户信息获取成功",
            userInfo: { ...req.curUser, password: null },
        })
    } else {
        res.status(401).json({
            code: -1,
            msg: "用户未登陆"
        })
    }
})



router.route("/register")
    .post((req, res, next) => {
         upload(req, res, (e) => {
                if (e instanceof Error) {
                    res.status(400).json({
                        code: -1,
                        msg: e.toString()
                    }).end()
                } else {
                    next()
                }
            })
        }, async (req, res, next) => {
            try {
                if (!req.registerPrecheck) {
                    registerPrecheck(req.session, req.body)
                }
            } catch (e) {
                res.status(400).json({
                    code: -1,
                    msg: e.message
                }).end()
                return
            }
            let userInfo = req.body
            let file = req.file
            let avatarOnlineHREF = "/uploads/" + (file ? path.basename(file.path) : "default.png")
            try {
                let { lastID } = await db.run(
                    `INSERT INTO users VALUES (?, ?, ?, ?, ?)`,
                    [userInfo.username, userInfo.password, userInfo.email, avatarOnlineHREF, moment().locale('zh-cn').format('YYYY-MM-DD HH:mm:ss')]
                )
                let newUser = await db.get(
                    `select * from users where rowid = ?`,
                    lastID)
                delete newUser.password
                res.status(200).json({
                    code: 0,
                    msg: "注册成功",
                    userInfo: newUser,
                }).end()
                delete req.session.captcha
            } catch (e) {
                res.status(400).json({
                    code: -1,
                    msg: e.toString(),
                }).end()
            }
        })

router.post("/register-check", async (req, res) => {
    let result = null
    if ("username" in req.body) {
        result = await db.get("SELECT * FROM users WHERE name = ?", req.body.username)
    } else {
        res.status(400).json({
            code: -1,
            msg: `请求错误`
        }).end()
    }
    if (result) {
        res.status(200).json({
            code: -1,
            msg: `用户名已被占用`
        }).end()
    } else {
        res.status(200).json({
            code: 0,
            msg: `可以使用`
        }).end()
    }
})

//GET: 登陆账户
router.route("/login")
    .post(async (req, res, next) => {
        let userInfo = req.body
        let user = await db.get(`
        SELECT *, rowid as ID FROM users
        WHERE users.name = ? 
        AND users.password = ?
    `, userInfo.username, userInfo.password)
        if (user) {
            res.cookie("user", userInfo.username, {
                maxAge: 86400000,
                signed: true,
            })
            res.json({
                code: 0,
                msg: "登陆成功",
                userInfo: { ...user, password: null },
            })
        } else {
            res.status(404).json({
                code: -1,
                msg: "用户名或密码错误",
            })
        }
    })

router.post("/logout", async (req, res, next) => {
    res.status(200).clearCookie("user").end()
})

router.route("/forgot-password")
    .post(async (req, res, next) => {
        try {
            var info = await db.get(`
                SELECT * 
                FROM users 
                WHERE users.name = ?
            `, req.body.username)
            if (!info) {
                throw(new Error("请输入正确的用户名"))
            }
            if (!info.email) {
                throw(new Error("该用户注册时未提供邮箱"))
            }
        } catch(e) {
            res.status(400).json({
                code: -1,
                msg: e.message,
            }).end()
            return
        }

        let randomLink = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
        pwdMap[randomLink] = info.name
        let link = `http://localhost:3000/forgot-changepwd?link=` + randomLink

        setTimeout(() => {
            delete pwdMap[randomLink]
        }, 30 * 60 * 1000)
        try {
            await transporter.sendMail({
                from: '"认证邮件"<testmyvote@163.com>',
                to: info.email,
                subject: "Hello 重置你的密码啦 ✔",
                html: `<div style='width: 500px; height:none; margin: 0 auto; box-sizing: border-box; border: 1px solid #000;'>
                <h1
                    style='font-size: 20px; margin: 0; width: 100%; padding: 10px; box-sizing: border-box; background-color: #e6f7ff;'>
                    SimpleVote
                </h1>
                <div style='padding: 20px; box-sizing: border-box;'>
                    <p style='margin: 0;'> 尊敬的${info.name}您好</p>
                    <p style='text-indent: 2em;'> 您的重置链接有效时间为30分钟,请在规定时间替换之内重置您的密码。<a href=${link}>立即重置密码</a></p>
                    <br />
                    <div style='padding: 5px; background: #f2f2f2; font-size: 12px;'>如果该邮件不是由你本人操作，请勿进行操作！</div>
                    <div
                        style='background: #fafafa; color: #b4b4b4;text-align: center; line-height: 45px; height: 45px; bottom: 0;width: 100%; font-size: 14px;'>
                        系统邮件，请勿直接回复</div>
                </div>
            </div>`,
            });
            res.status(200).json({
                code: 0,
                msg: "邮件发送成功"
            }).end()
        } catch (e) {
            res.status(400).json({
                code: -1,
                msg: "邮件发送失败"
            }).end()
        }
    })


router.route("/forgot-changepwd")


    .post(async (req, res, next) => {
        if (req.body.password !== req.body.confirm) {
            res.status(400).json({
                code: -1,
                msg: "两次输入密码不一致"
            }).end()
            return
        }
        if (req.body.link in pwdMap) {
            try {
                await db.run(`
                UPDATE users 
                SET password = ? 
                WHERE users.name = ?
            `, req.body.password, pwdMap[req.body.link])
                delete pwdMap[req.body.link]
                res.status(200).json({
                    code: 0,
                    msg: "重置成功",
                }).end()
            } catch (e) {
                res.status(400).json({
                    code: -1,
                    msg: "重置失败",
                }).end()
            }
        } else {
            res.status(400).json({
                code: -2,
                msg: "链接已失效",
            }).end()
        }
    })


module.exports = router;