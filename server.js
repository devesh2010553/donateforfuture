require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const webpush = require('web-push');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { Chat, PushSubscription } = require('./models');
const { sendAdminPush } = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// VAPID
webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Middleware
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com", "cdnjs.cloudflare.com", "cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
      frameSrc: ["'self'", "www.youtube.com", "youtube.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);

// Attach io to req
app.use((req, res, next) => { req.io = io; next(); });

// Routes
app.use('/api', require('./routes/api'));

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/adminmsup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/schoolproject')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(e => console.log('⚠️  MongoDB:', e.message, '(running in demo mode)'));

// Socket.io Real-time
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('joinChat', ({ sessionId }) => {
    socket.join(`chat:${sessionId}`);
    socket.join('admin');
  });

  socket.on('joinAdmin', () => {
    socket.join('admin');
    socket.join('adminOnly');
  });

  socket.on('chatMessage', async (data) => {
    try {
      const msg = new Chat({
        senderName: data.senderName,
        senderPhone: data.senderPhone,
        message: data.message,
        isAdmin: data.isAdmin || false,
        sessionId: data.sessionId
      });
      await msg.save();

      // Emit to session room and admin
      io.to(`chat:${data.sessionId}`).emit('newMessage', msg);
      io.to('adminOnly').emit('newMessage', msg);

      // Push notification to admin if user message
      if (!data.isAdmin) {
        await sendAdminPush({
          title: `💬 New Message from ${data.senderName}`,
          body: data.message.substring(0, 80),
          url: '/adminmsup'
        }, io);
      }
    } catch (e) {
      console.error('Chat error:', e.message);
    }
  });

  socket.on('adminTyping', (data) => {
    io.to(`chat:${data.sessionId}`).emit('adminTyping', data);
  });

  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📊 Public page: http://localhost:${PORT}/`);
  console.log(`🔐 Admin page: http://localhost:${PORT}/adminmsup\n`);
});
