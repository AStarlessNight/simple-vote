const express = require('express');
const router = express.Router();
const svgCaptcha = require("svg-captcha")


router.use("/user", require("./user"))
router.use("/vote", require("./vote"))

router.get("/captcha", (req, res, next) => {
    var captcha = svgCaptcha.create({
        size: 4,
        ignoreChars: "0oO1ilI",
        noise: 1,
    });
    req.session.captcha = new RegExp(`^${captcha.text}$`, "i")
    setTimeout(() => {
        delete req.session.captcha
    }, 600000)
    res.type('svg');
    res.setHeader("Cache-Control", "no-store")
    res.status(200).send(captcha.data)
})


module.exports = router