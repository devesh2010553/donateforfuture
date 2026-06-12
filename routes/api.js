const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const { ProjectState, Donor, Chat, PushSubscription } = require('../models');
const authMiddleware = require('../middleware/auth');

// ─── Auth ────────────────────────────────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'Makingupfreeschool@10years##';
  if (password !== adminPassword) return res.status(401).json({ error: 'Invalid password' });
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// ─── Project State ────────────────────────────────────────────────────────────
router.get('/state', async (req, res) => {
  try {
    let state = await ProjectState.findOne();
    if (!state) state = await ProjectState.create({});
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/state', authMiddleware, async (req, res) => {
  try {
    const { currentRaised, videoLinks } = req.body;
    let state = await ProjectState.findOne();
    if (!state) state = new ProjectState();
    if (currentRaised !== undefined) state.currentRaised = currentRaised;
    if (videoLinks !== undefined) state.videoLinks = videoLinks;
    state.updatedAt = new Date();
    await state.save();
    req.io.emit('stateUpdate', state);
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/state/video', authMiddleware, async (req, res) => {
  try {
    const { url } = req.body;
    let state = await ProjectState.findOne();
    if (!state) state = new ProjectState();
    state.videoLinks.push(url);
    await state.save();
    req.io.emit('stateUpdate', state);
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/state/video/:index', authMiddleware, async (req, res) => {
  try {
    let state = await ProjectState.findOne();
    state.videoLinks.splice(parseInt(req.params.index), 1);
    await state.save();
    req.io.emit('stateUpdate', state);
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Donors ───────────────────────────────────────────────────────────────────
router.post('/donors', async (req, res) => {
  try {
    const donor = new Donor(req.body);
    await donor.save();
    // Notify admin via push
    await sendAdminPush({
      title: '💰 New Donation Submitted',
      body: `${donor.name} pledged ₹${donor.amount.toLocaleString('en-IN')} — awaiting verification`,
      url: '/adminmsup'
    }, req.io);
    req.io.emit('newDonor', { donor: sanitizeDonor(donor), verified: false });
    res.status(201).json({ success: true, id: donor._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/donors', authMiddleware, async (req, res) => {
  try {
    const donors = await Donor.find().sort({ amount: -1 });
    res.json(donors);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/donors/public', async (req, res) => {
  try {
    const donors = await Donor.find({ verified: true }).sort({ amount: -1 }).select('name place amount createdAt');
    res.json(donors);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/donors/:id/verify', authMiddleware, async (req, res) => {
  try {
    const donor = await Donor.findByIdAndUpdate(req.params.id, {
      verified: true,
      transactionId: req.body.transactionId
    }, { new: true });
    // Update raised amount
    const state = await ProjectState.findOne() || new ProjectState();
    const totalVerified = await Donor.aggregate([
      { $match: { verified: true } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    state.currentRaised = totalVerified[0]?.total || state.currentRaised;
    await state.save();
    req.io.emit('stateUpdate', state);
    req.io.emit('donorVerified', { donor: sanitizeDonor(donor) });
    res.json({ success: true, donor });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/donors/:id', authMiddleware, async (req, res) => {
  try {
    await Donor.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function sanitizeDonor(d) {
  return { _id: d._id, name: d.name, place: d.place, amount: d.amount, createdAt: d.createdAt };
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
router.get('/chat/:sessionId', async (req, res) => {
  try {
    const messages = await Chat.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 }).limit(100);
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/chat', authMiddleware, async (req, res) => {
  try {
    // Get all unique sessions with latest message
    const sessions = await Chat.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$sessionId', lastMessage: { $first: '$$ROOT' }, count: { $sum: 1 } } },
      { $sort: { 'lastMessage.createdAt': -1 } }
    ]);
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/chat/:sessionId', authMiddleware, async (req, res) => {
  try {
    await Chat.deleteMany({ sessionId: req.params.sessionId });
    req.io.emit('chatCleared', { sessionId: req.params.sessionId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/chat', authMiddleware, async (req, res) => {
  try {
    await Chat.deleteMany({});
    req.io.emit('allChatsCleared');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Push Notifications ───────────────────────────────────────────────────────
router.post('/push/subscribe', async (req, res) => {
  try {
    const { subscription, type } = req.body;
    await PushSubscription.findOneAndUpdate(
      { 'subscription.endpoint': subscription.endpoint },
      { subscription, type: type || 'admin' },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/push/vapidPublicKey', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

async function sendAdminPush(data, io) {
  try {
    const subs = await PushSubscription.find({ type: 'admin' });
    const payload = JSON.stringify(data);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub.subscription, payload);
      } catch (e) {
        if (e.statusCode === 410) await PushSubscription.findByIdAndDelete(sub._id);
      }
    }
  } catch (e) {
    console.error('Push error:', e.message);
  }
}

module.exports = router;
module.exports.sendAdminPush = sendAdminPush;
