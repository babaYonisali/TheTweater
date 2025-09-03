const express = require('express');
const mongoose = require('mongoose');
const TelegramBotHandler = require('./bot/TelegramBotHandler');
const { loadTemplate } = require('./utils/templateLoader');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Config ----------
const {
  MONGODB_URI,
  TELEGRAM_BOT_TOKEN,
  X_CLIENT_ID,
  X_CLIENT_SECRET,
  X_CALLBACK_URL = process.env.NODE_ENV === 'production' 
    ? process.env.X_CALLBACK_URL 
    : 'http://localhost:3000/auth/x/callback',
  DEEPSEEK_API_KEY,
  NODE_ENV
} = process.env;

// Validate required environment variables
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!X_CLIENT_ID || !X_CLIENT_SECRET) {
  console.error('❌ X_CLIENT_ID and X_CLIENT_SECRET environment variables are required');
  process.exit(1);
}

if (!DEEPSEEK_API_KEY) {
  console.error('❌ DEEPSEEK_API_KEY environment variable is required');
  process.exit(1);
}

// ---------- Initialize Bot Handler ----------
const botHandler = new TelegramBotHandler();

// ---------- MongoDB ----------
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // Increased timeout
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000, // Increased timeout
  maxPoolSize: 10,
  retryWrites: true,
  w: 'majority',
  bufferCommands: false, // Disable mongoose buffering
  bufferMaxEntries: 0 // Disable mongoose buffering
});

const db = mongoose.connection;

// Connection event handlers with retry logic
db.on('error', (error) => {
  console.error('❌ MongoDB connection error:', error);
  // Don't exit on connection errors in production
  if (process.env.NODE_ENV !== 'production') {
    console.error('❌ Exiting due to MongoDB connection error in development');
    process.exit(1);
  }
});

db.on('connected', () => console.log('✅ Connected to MongoDB'));

db.on('disconnected', () => {
  console.log('❌ Disconnected from MongoDB');
  // Attempt to reconnect after a delay
  setTimeout(() => {
    console.log('🔄 Attempting to reconnect to MongoDB...');
    mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority'
    });
  }, 5000);
});

db.once('open', () => console.log('🚀 MongoDB connection established'));

// ---------- Middleware ----------
app.use(express.json());

// ---------- Routes ----------

// Serve static files (for the logo)
app.get('/wengroLogo.jpg', (req, res) => {
  res.sendFile(__dirname + '/wengroLogo.jpg');
});

// Webhook endpoint for receiving Telegram updates
app.post('/webhook', async (req, res) => {
  try {
    console.log('📨 Webhook received');
    
    // Check if bot handler is initialized
    if (!botHandler.isInitialized) {
      console.error('❌ Bot handler not initialized yet, ignoring webhook');
      return res.status(503).send('Bot not ready');
    }
    
    await botHandler.handleWebhookUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).send('Internal server error');
  }
});

// OAuth callback endpoint
app.get('/auth/x/callback', async (req, res) => {
  const { code, state } = req.query;
  
  console.log('🔗 OAuth Callback Received:');
  console.log('  Code:', code);
  console.log('  State:', state);
  
  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter');
  }
  
  try {
    // The bot handler will process this through the webhook
    // Show the actual callback URL with parameters that the user needs to send back
    const actualCallbackUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    console.log('📱 Displaying callback URL to user:', actualCallbackUrl);
    res.send(loadTemplate('authSuccess', { CALLBACK_URL: actualCallbackUrl }));
  } catch (error) {
    console.error('❌ Error handling OAuth callback:', error);
    res.status(500).send('Internal server error');
  }
});

// Simple test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is responding',
    timestamp: new Date().toISOString(),
    bot: 'Active'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  // Check if user wants HTML or JSON
  const acceptsHtml = req.accepts('html');
  
  if (acceptsHtml) {
    // Return stylized HTML page using template
    const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
    const dbStatusClass = mongoose.connection.readyState === 1 ? 'status-ok' : 'status-error';
    
    res.send(loadTemplate('health', {
      DB_STATUS: dbStatus,
      DB_STATUS_CLASS: dbStatusClass,
      PORT: PORT,
      TIMESTAMP: new Date().toLocaleString()
    }));
  } else {
    // Return JSON for API calls
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      message: 'Twitter Bot server is running',
      bot: 'Active',
      database: db.readyState === 1 ? 'Connected' : 'Disconnected',
      port: PORT,
      uptime: process.uptime()
    });
  }
});

// Favicon route
app.get('/favicon.ico', (req, res) => {
  res.status(204); // No content for favicon
});

// Custom 404 page
app.use('*', (req, res) => {
  res.status(404).send(loadTemplate('404', { REQUESTED_PATH: req.originalUrl }));
});

// ---------- Webhook Setup ----------
async function setupWebhook() {
  try {
    // Only set webhook in production (Vercel)
    if (process.env.NODE_ENV === 'production' && process.env.VERCEL_URL) {
      const webhookUrl = `https://${process.env.VERCEL_URL}/webhook`;
      
      console.log('🔗 Setting webhook URL for production:', webhookUrl);
      
      // Use the bot instance from the handler to set webhook
      const result = await botHandler.bot.setWebHook(webhookUrl);
      console.log('✅ Webhook set successfully:', result);
    } else {
      // For local development, use polling
      console.log('🔄 Using polling mode for local development');
      botHandler.bot.startPolling();
    }
  } catch (error) {
    console.error('❌ Failed to set webhook:', error);
    console.error('❌ Error details:', error.message);
    
    // Fallback to polling
    console.log('🔄 Falling back to polling mode');
    botHandler.bot.startPolling();
  }
}

// ---------- Initialize Bot Handler First ----------
async function initializeBot() {
  try {
    console.log('🔧 Initializing bot handler...');
    await botHandler.init();
    console.log('✅ Bot handler initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize bot handler:', error);
    process.exit(1);
  }
}

// ---------- Start Server and Bot ----------
async function startServer() {
  try {
    // Initialize bot handler first
    await initializeBot();
    
    // Start the server
    app.listen(PORT, async () => {
      console.log(`🚀 Twitter Bot with AI Content Creator server running on http://localhost:${PORT}`);
      console.log(`🔗 Callback URL: http://localhost:${PORT}/auth/x/callback`);
      
      // Set up webhook
      await setupWebhook();
      
      console.log('📱 Bot commands:');
      console.log('   /start - Welcome message');
      console.log('   /connect - Connect Twitter account');
      console.log('   /post <text> - Post tweet');
      console.log('   /state - Check connection status');
      console.log('   /disconnect - Disconnect account');
      console.log('   /help - Show help');
      console.log('   /test - Test if bot is working');
      console.log('🤖 AI Content Creator: Send any message for content creation help');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  try {
    if (process.env.NODE_ENV === 'production') {
      await botHandler.bot.deleteWebHook();
      console.log('✅ Webhook deleted');
    } else {
      botHandler.bot.stopPolling();
      console.log('✅ Polling stopped');
    }
    await botHandler.stop();
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
  mongoose.connection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  try {
    if (process.env.NODE_ENV === 'production') {
      await botHandler.bot.deleteWebHook();
      console.log('✅ Webhook deleted');
    } else {
      botHandler.bot.stopPolling();
      console.log('✅ Polling stopped');
    }
    await botHandler.stop();
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
  mongoose.connection.close();
  process.exit(0);
});
