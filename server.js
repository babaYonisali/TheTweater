// ============================================
// FIXED VERSION FOR YOUR OTHER BOT PROJECT
// ============================================
// This shows the key changes needed to fix cold start issues

const express = require('express');
const TelegramBotHandler = require('./bot/TelegramBotHandler');
const { loadTemplate } = require('./utils/templateLoader');
const database = require('./config/database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Config ----------
const {
  MONGODB_URI,
  MONGODB_DB_NAME = 'tweetbot',
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

// ============================================
// KEY FIX: Initialization Promise
// ============================================
// This ensures bot and database are initialized before processing webhooks
let initializationPromise = null;

async function ensureInitialized() {
  // If already initialized, return immediately
  if (botHandler.isInitialized && database.getConnectionStatus()) {
    return;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start new initialization
  initializationPromise = (async () => {
    try {
      console.log('🔧 Cold start detected - initializing bot and database...');
      
      // Initialize database first
      if (!database.getConnectionStatus()) {
        console.log('📊 Connecting to database...');
        await database.connect();
        console.log('✅ Database connected');
      }

      // Initialize bot handler
      if (!botHandler.isInitialized) {
        console.log('🤖 Initializing bot handler...');
        await botHandler.init();
        console.log('✅ Bot handler initialized');
      }

      console.log('✅ Initialization complete');
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      // Reset promise so we can retry
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
}

// ---------- Middleware ----------
app.use(express.json());

// ---------- Routes ----------

// Serve static files (for the logo)
app.get('/wengroLogo.jpg', (req, res) => {
  res.sendFile(__dirname + '/wengroLogo.jpg');
});

// ============================================
// KEY FIX: Webhook endpoint with proper initialization
// ============================================
app.post('/webhook', async (req, res) => {
  // Respond immediately to Telegram to prevent timeout
  res.status(200).json({ status: 'OK' });
  
  // Process webhook update asynchronously AFTER ensuring initialization
  (async () => {
    try {
      console.log('📨 Webhook received');
      
      // CRITICAL: Ensure initialization completes before processing
      await ensureInitialized();
      
      // Now process the webhook update
      await botHandler.handleWebhookUpdate(req.body);
      console.log('✅ Webhook processed successfully');
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      console.error('❌ Error stack:', error.stack);
      
      // Try to send error message to user if possible
      try {
        if (botHandler.isInitialized && botHandler.bot && req.body?.message?.chat?.id) {
          await botHandler.bot.sendMessage(
            req.body.message.chat.id,
            '⚠️ Bot is initializing. Please try again in a moment.'
          );
        }
      } catch (sendError) {
        console.error('❌ Failed to send error message:', sendError);
      }
    }
  })();
});

// ============================================
// KEY FIX: Health check that also initializes (warms up function)
// ============================================
app.get('/health', async (req, res) => {
  try {
    // This endpoint warms up the function and ensures initialization
    await ensureInitialized();
    
    const dbStatus = database.getConnectionStatus() ? 'Connected' : 'Disconnected';
    const dbStatusClass = database.getConnectionStatus() ? 'status-ok' : 'status-error';
    
    // Check if user wants HTML or JSON
    const acceptsHtml = req.accepts('html');
    
    if (acceptsHtml) {
      res.send(loadTemplate('health', {
        DB_STATUS: dbStatus,
        DB_STATUS_CLASS: dbStatusClass,
        PORT: PORT,
        TIMESTAMP: new Date().toLocaleString()
      }));
    } else {
      res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        message: 'Twitter Bot server is running',
        bot: botHandler.isInitialized ? 'Initialized' : 'Not Initialized',
        database: dbStatus,
        port: PORT,
        uptime: process.uptime()
      });
    }
  } catch (error) {
    console.error('❌ Health check error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Initialization failed',
      error: error.message
    });
  }
});

// Root endpoint - also warms up the function
app.get('/', async (req, res) => {
  try {
    await ensureInitialized();
    res.json({
      message: 'Twitter Bot API',
      status: 'OK',
      bot: botHandler.isInitialized ? 'Initialized' : 'Not Initialized',
      database: database.getConnectionStatus() ? 'Connected' : 'Disconnected'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Initialization failed',
      error: error.message
    });
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
    await ensureInitialized();
    const actualCallbackUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    console.log('📱 Displaying callback URL to user:', actualCallbackUrl);
    res.send(loadTemplate('authSuccess', { CALLBACK_URL: actualCallbackUrl }));
  } catch (error) {
    console.error('❌ Error handling OAuth callback:', error);
    res.status(500).send('Internal server error');
  }
});

// Simple test endpoint
app.get('/test', async (req, res) => {
  try {
    await ensureInitialized();
    res.json({ 
      status: 'OK', 
      message: 'Server is responding',
      timestamp: new Date().toISOString(),
      bot: botHandler.isInitialized ? 'Initialized' : 'Not Initialized',
      database: database.getConnectionStatus() ? 'Connected' : 'Disconnected'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Initialization failed',
      error: error.message
    });
  }
});

// Test webhook endpoint
app.post('/test-webhook', async (req, res) => {
  try {
    await ensureInitialized();
    console.log('🧪 Test webhook endpoint called');
    console.log('🧪 Request body:', JSON.stringify(req.body, null, 2));
    res.json({ 
      status: 'OK', 
      message: 'Test webhook endpoint working',
      timestamp: new Date().toISOString(),
      received: req.body
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Initialization failed',
      error: error.message
    });
  }
});

// Initialize bot endpoint
app.post('/init-bot', async (req, res) => {
  try {
    console.log('🔄 Manual bot initialization requested');
    await ensureInitialized();
    res.json({ 
      status: 'OK', 
      message: 'Bot initialized successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Failed to initialize bot:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Failed to initialize bot',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Test webhook with fake message
app.post('/test-bot', async (req, res) => {
  try {
    console.log('🧪 Testing bot with fake message');
    await ensureInitialized();
    
    const fakeUpdate = {
      message: {
        message_id: 123,
        from: {
          id: 123456789,
          is_bot: false,
          first_name: "Test",
          username: "testuser"
        },
        chat: {
          id: 123456789,
          first_name: "Test",
          username: "testuser",
          type: "private"
        },
        date: Math.floor(Date.now() / 1000),
        text: "/start"
      }
    };
    
    await botHandler.handleWebhookUpdate(fakeUpdate);
    res.json({ 
      status: 'OK', 
      message: 'Test message sent to bot',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Failed to test bot:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Failed to test bot',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Set webhook URL manually
app.post('/set-webhook', async (req, res) => {
  try {
    await ensureInitialized();
    const { url } = req.body;
    const webhookUrl = url || 'https://the-tweater-theta.vercel.app/webhook';
    
    console.log('🔗 Manually setting webhook URL:', webhookUrl);
    const result = await botHandler.bot.setWebHook(webhookUrl);
    console.log('✅ Webhook set successfully:', result);
    
    const webhookInfo = await botHandler.bot.getWebHookInfo();
    console.log('📊 Webhook info:', webhookInfo);
    
    res.json({ 
      status: 'OK', 
      message: 'Webhook URL set successfully',
      url: webhookUrl,
      result: result,
      webhookInfo: webhookInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Failed to set webhook:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Failed to set webhook',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get webhook info
app.get('/webhook-info', async (req, res) => {
  try {
    await ensureInitialized();
    
    if (!botHandler.isInitialized) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Bot not initialized',
        timestamp: new Date().toISOString()
      });
    }
    
    const webhookInfo = await botHandler.bot.getWebHookInfo();
    res.json({
      status: 'OK',
      webhookInfo: webhookInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Failed to get webhook info:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Failed to get webhook info',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Favicon route
app.get('/favicon.ico', (req, res) => {
  res.status(204);
});

// Custom 404 page
app.use('*', (req, res) => {
  res.status(404).send(loadTemplate('404', { REQUESTED_PATH: req.originalUrl }));
});

// Export the app for Vercel
module.exports = app;

// ============================================
// KEY FIX: Simplified initialization for production
// ============================================
// For Vercel, we don't initialize at module load
// Instead, we initialize on first request (via ensureInitialized)
// This is handled by the ensureInitialized() function above

// For local development, initialize everything
if (process.env.NODE_ENV !== 'production') {
  async function initialize() {
    try {
      console.log('🔧 Local development: Initializing bot and database...');
      await database.connect();
      await botHandler.init();
      console.log('✅ All systems initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize:', error);
      process.exit(1);
    }
  }

  initialize();

  app.listen(PORT, () => {
    console.log(`🚀 Twitter Bot with AI Content Creator server running on http://localhost:${PORT}`);
    console.log(`🔗 Callback URL: http://localhost:${PORT}/auth/x/callback`);
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
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  try {
    if (process.env.NODE_ENV === 'production') {
      if (botHandler.isInitialized && botHandler.bot) {
        await botHandler.bot.deleteWebHook();
        console.log('✅ Webhook deleted');
      }
    } else {
      if (botHandler.bot) {
        botHandler.bot.stopPolling();
        console.log('✅ Polling stopped');
      }
    }
    await botHandler.stop();
    await database.disconnect();
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  try {
    if (process.env.NODE_ENV === 'production') {
      if (botHandler.isInitialized && botHandler.bot) {
        await botHandler.bot.deleteWebHook();
        console.log('✅ Webhook deleted');
      }
    } else {
      if (botHandler.bot) {
        botHandler.bot.stopPolling();
        console.log('✅ Polling stopped');
      }
    }
    await botHandler.stop();
    await database.disconnect();
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
  process.exit(0);
});

