const bcrypt = require('bcryptjs')
const { ImgurClient } = require('imgur')
const client = new ImgurClient({ clientId: process.env.IMGUR_CLIENT_ID })
const { User, Tweet, Like, Reply, Followship, sequelize } = require('../models')
const helpers = require('../_helpers')
const Ajv = require('ajv').default
const addFormats = require('ajv-formats')
const ajv = new Ajv({ allErrors: true }) // 顯示超過一個以上的 errors
addFormats(ajv)
require('ajv-errors')(ajv)
const validateUserInfo = require('../middleware/validateUserInfo')
const validate = ajv.compile(validateUserInfo.schema)

// JWT
const jwt = require('jsonwebtoken')

function getData(data) {
  if (data) return data.map((d) => d.id)
  return []
}

const userController = {
  signIn: (req, res, next) => {
    if (!req.body.account || !req.body.password) {
      throw new Error('請輸入必填項目')
    }

    User.findOne({
      where: { account: req.body.account }
    })
      .then((user) => {
        if (!user) throw new Error('此使用者尚未註冊')
        if (user.role === 'admin') throw new Error('管理者請從後台登入')

        if (!bcrypt.compareSync(req.body.password, user.password)) {
          throw new Error('密碼輸入錯誤')
        }

        var payload = { id: user.id }
        var token = jwt.sign(payload, 'alphacamp')
        return res.json({
          status: 'success',
          message: 'Login successfully',
          token: token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            account: user.account,
            role: user.role
          }
        })
      })
      .catch((err) => next(err))
  },

  signUp: async (req, res, next) => {
    try {
      const result = await validateUserInfo.checkUserInfo(req, validate)
      if (result) return res.json({ status: 'error', message: result, data: req.body })

      await User.create({
        name: req.body.name.trim(),
        email: req.body.email,
        account: req.body.account.trim(),
        role: 'user',
        avatar: 'https://i.imgur.com/TmLy5dw.png',
        cover: 'https://i.imgur.com/pNr8Hlb.jpeg',
        password: bcrypt.hashSync(req.body.password, bcrypt.genSaltSync(10), null)
      })
      return res.json({ status: 'success', message: '成功註冊帳號！' })
    } catch (error) {
      next(error)
    }
  },

  getUser: async (req, res, next) => {
    try {
      const selfId = helpers.getUser(req).id
      const user = await await User.findByPk(req.params.userId, {
        include: [
          { model: Tweet, attributes: [] },
          { model: User, as: 'Followers', attributes: [], through: { attributes: [] } },
          { model: User, as: 'Followings', attributes: [], through: { attributes: [] } }
        ],
        attributes: [
          'id',
          'name',
          'account',
          'introduction',
          'avatar',
          'cover',
          [
            sequelize.literal('(SELECT COUNT(*) FROM Followships WHERE Followships.followerId = User.id)'),
            'followingCount'
          ],
          [
            sequelize.literal('(SELECT COUNT(*) FROM Followships WHERE Followships.followingId = User.id)'),
            'followerCount'
          ],
          [sequelize.literal('(SELECT COUNT(*) FROM Tweets WHERE Tweets.UserId = User.id)'), 'tweetCount'],
          [
            sequelize.literal(
              `exists (SELECT true FROM Followships WHERE FollowerId = ${selfId} AND FollowingId = User.id)`
            ),
            'isFollowing'
          ]
        ]
      })

      if (!user) throw new Error('找不到使用者')
      console.log(user.toJSON())

      return res.json(user.toJSON())
    } catch (error) {
      next(error)
    }
  },

  getUserTweets: async (req, res, next) => {
    try {
      const user = await User.findByPk(req.params.userId, {
        include: [{ model: Tweet, include: [Like, Reply] }],
        order: [[Tweet, 'createdAt', 'DESC']]
      })
      if (!user) throw new Error('這名使用者不存在或已被刪除')

      // LikedTweets 有資料才做 map 處理，不然 test 會過不了
      const likes = getData(helpers.getUser(req).LikedTweets)

      const tweets = user.Tweets.map((t) => ({
        userId: user.toJSON().id,
        userName: user.toJSON().name,
        userAvatar: user.toJSON().avatar,
        userAccount: user.toJSON().account,
        tweetId: t.dataValues.id,
        createdAt: t.dataValues.createdAt,
        description: t.dataValues.description,
        replyCount: t.dataValues.Replies.length,
        likeCount: t.dataValues.Likes.length,
        isLiked: likes.length ? likes.includes(t.dataValues.id) : false
      }))

      return res.json(tweets)
    } catch (error) {
      next(error)
    }
  },

  getAllReplies: async (req, res, next) => {
    try {
      const replies = await User.findByPk(req.params.userId, {
        include: Reply,
        attributes: [],
        order: [[Reply, 'createdAt', 'DESC']]
      })
      if (!replies) throw new Error('這名使用者不存在或已被刪除')

      return res.json(replies.toJSON().Replies)
    } catch (error) {
      next(error)
    }
  },

  getLikes: async (req, res, next) => {
    try {
      const like = await User.findByPk(req.params.userId, {
        attributes: [],
        include: [
          {
            model: Like,
            attributes: { exclude: ['updatedAt'] },
            include: [
              {
                model: Tweet,
                attributes: { exclude: ['updatedAt'] },
                include: [
                  { model: User, attributes: ['id', 'name', 'account', 'avatar'] },
                  { model: Like, attributes: ['TweetId'] },
                  { model: Reply, attributes: ['TweetId'] }
                ]
              }
            ]
          }
        ],
        order: [[Like, 'createdAt', 'DESC']]
      })
      if (!like) throw new Error('這名使用者不存在或已被刪除')

      const likes = getData(helpers.getUser(req).LikedTweets)

      const data = like.toJSON().Likes.map((d) => ({
        userId: d.UserId,
        TweetId: d.TweetId,
        userName: d.Tweet.User.name,
        userAccount: d.Tweet.User.account,
        userAvatar: d.Tweet.User.avatar,
        description: d.Tweet.description,
        likeCount: d.Tweet.Likes.length,
        replyCount: d.Tweet.Replies.length,
        isLiked: likes.length ? likes.includes(d.TweetId) : false
      }))

      res.json(data)
    } catch (error) {
      next(error)
    }
  },

  getFollowings: async (req, res, next) => {
    try {
      const following = await User.findByPk(req.params.userId, {
        attributes: [],
        include: [
          {
            model: User,
            as: 'Followings',
            attributes: [['id', 'followingId'], 'name', 'account', 'avatar', 'introduction'],
            through: { attributes: [] }
          }
        ],
        order: [[sequelize.literal('`Followings->Followship`.`createdAt`'), 'DESC']] // '->' returns JSON object field by key
      })
      if (!following) throw new Error('這名使用者不存在或已被刪除')

      const isFollowing = getData(helpers.getUser(req).Followings)

      const data = following.toJSON().Followings.map((d) => ({
        ...d,
        isFollowing: isFollowing.includes(d.followingId)
      }))

      res.json(data)
    } catch (error) {
      next(error)
    }
  },

  getFollowers: async (req, res, next) => {
    try {
      const followers = await User.findByPk(req.params.userId, {
        attributes: [],
        include: [
          {
            model: User,
            as: 'Followers',
            attributes: [['id', 'followerId'], 'name', 'account', 'avatar', 'introduction'],
            through: { attributes: [] }
          }
        ],
        order: [[sequelize.literal('`Followers->Followship`.`createdAt`'), 'DESC']] // '->' returns JSON object field by key
      })
      if (!followers) throw new Error('這名使用者不存在或已被刪除')

      const isFollowing = getData(helpers.getUser(req).Followings)

      const data = followers.toJSON().Followers.map((d) => ({
        ...d,
        isFollowing: isFollowing.includes(d.followerId)
      }))

      res.json(data)
    } catch (error) {
      next(error)
    }
  },

  putUser: async (req, res, next) => {
    let { name, introduction } = req.body
    const { files } = req
    const userId = helpers.getUser(req).id
    const id = Number(req.params.userId)

    try {
      if (id !== userId) throw new Error('只能修改自己的個人資訊')
      if (!name) throw new Error('名字為必填')

      const result = await validateUserInfo.checkUserInfo(req, validate)
      if (result) return res.json({ status: 'error', message: result, data: req.body })

      const user = await User.findByPk(id)
      if (!user) throw new Error('user not found.')

      // setting
      if (req.body.setting) {
        await user.update({
          name: req.body.name,
          email: req.body.email,
          account: req.body.account.trim(),
          password: bcrypt.hashSync(req.body.password, bcrypt.genSaltSync(10), null)
        })
        return res.json({ status: 'success', message: 'update successfully！' })
      }

      // profile edit
      const images = {}
      if (files) {
        for (const key in files) {
          // req.files 是一個物件 (String -> Array) 键是文件名，值是文件陣列
          // e.g. req.files['avatar'][0] -> File
          console.log(files[key][0].path)
          images[key] = await client.upload(files[key][0].path)
        }
      }

      // console.log(images.avatar)
      await user.update({
        name: name.trim(),
        introduction,
        avatar: images.avatar ? images.avatar.data.link : user.avatar,
        cover: images.cover ? images.cover.data.link : user.cover
      })

      return res.json({ status: 'success', message: 'update successfully' })
    } catch (error) {
      next(error)
    }
  },

  addFollowing: async (req, res, next) => {
    try {
      if (Number(req.body.id) === helpers.getUser(req).id) throw new Error('你無法追蹤自己')
      const isFollowing = await Followship.findOne({
        where: {
          followerId: helpers.getUser(req).id,
          followingId: req.body.id
        }
      })
      if (isFollowing) throw new Error('你已追蹤過這名使用者')

      await Followship.create({ followerId: helpers.getUser(req).id, followingId: Number(req.body.id) })
      return res.json({ status: 'success', message: '追蹤成功' })
    } catch (error) {
      next(error)
    }
  },

  removeFollowing: async (req, res, next) => {
    try {
      if (Number(req.params.followingId) === helpers.getUser(req).id) {
        throw new Error('無法取消追蹤自己')
      }

      const followship = await Followship.findOne({
        where: { followerId: helpers.getUser(req).id, followingId: req.params.followingId }
      })
      if (!followship) res.json({ status: 'error', message: '不能移除你沒追蹤過的使用者' })

      await followship.destroy()
      return res.json({ status: 'success', message: 'unfollow successfully' })
    } catch (error) {
      next(error)
    }
  },

  getTopUsers: async (req, res, next) => {
    try {
      const userId = helpers.getUser(req).id
      const users = await User.findAll({
        where: { $not: { role: 'admin' } },
        include: { model: User, as: 'Followers', attributes: [], through: { attributes: [] } },
        attributes: [
          'id',
          'name',
          'avatar',
          'account',
          [
            sequelize.literal('(SELECT COUNT(*) FROM Followships WHERE Followships.followingId = User.id)'),
            'followersCount'
          ],
          [
            sequelize.literal(
              `exists (SELECT true FROM Followships WHERE FollowerId = ${userId} AND FollowingId = User.id)`
            ),
            'isFollowing'
          ]
        ],
        order: [[sequelize.literal('isFollowing'), 'DESC']],
        order: [[sequelize.literal('followersCount'), 'DESC']],
        limit: 10
      })

      res.json(users)
    } catch (error) {
      next(error)
    }
  },

  getCurrentUser: (req, res) => {
    const user = helpers.getUser(req)
    console.log(user)
    return res.json({
      id: user.id,
      name: user.name,
      account: user.account,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      cover: user.cover,
      introduction: user.introduction
    })
  }
}

module.exports = userController
