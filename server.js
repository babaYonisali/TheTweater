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
  MONGODB_DB_NAME = 'tweetbot', // Default database name
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
// Database connection will be handled by the Database class

// ---------- Middleware ----------
app.use(express.json());

// ---------- Routes ----------

// Serve static files (for the logo)
app.get('/wengroLogo.jpg', (req, res) => {
  res.sendFile(__dirname + '/wengroLogo.jpg');
});

// Webhook endpoint for receiving Telegram updates
app.post('/webhook', async (req, res) => {
  // Respond immediately to Telegram to prevent timeout
  // This is crucial for Vercel cold starts
  res.status(200).json({ status: 'OK' });
  
  // Process webhook update asynchronously (don't await)
  (async () => {
    try {
      console.log('📨 Webhook received');
      console.log('📨 Bot initialized:', botHandler.isInitialized);
      
      // Ensure database connection (non-blocking)
      if (!database.getConnectionStatus()) {
        try {
          await database.connect();
        } catch (dbError) {
          console.error('❌ Database connection failed:', dbError.message);
        }
      }
      
      // If bot handler is not initialized, try to initialize it
      if (!botHandler.isInitialized) {
        console.log('🔄 Bot handler not initialized, attempting to initialize...');
        try {
          await botHandler.init();
          console.log('✅ Bot handler initialized successfully');
        } catch (initError) {
          console.error('❌ Failed to initialize bot handler:', initError);
          return;
        }
      }
      
      await botHandler.handleWebhookUpdate(req.body);
      console.log('✅ Webhook processed successfully');
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      console.error('❌ Error stack:', error.stack);
    }
  })();
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
    bot: botHandler.isInitialized ? 'Initialized' : 'Not Initialized',
    database: database.getConnectionStatus() ? 'Connected' : 'Disconnected'
  });
});

// Test webhook endpoint
app.post('/test-webhook', (req, res) => {
  console.log('🧪 Test webhook endpoint called');
  console.log('🧪 Request body:', JSON.stringify(req.body, null, 2));
  res.json({ 
    status: 'OK', 
    message: 'Test webhook endpoint working',
    timestamp: new Date().toISOString(),
    received: req.body
  });
});

// Initialize bot endpoint
app.post('/init-bot', async (req, res) => {
  try {
    console.log('🔄 Manual bot initialization requested');
    if (botHandler.isInitialized) {
      return res.json({ 
        status: 'OK', 
        message: 'Bot already initialized',
        timestamp: new Date().toISOString()
      });
    }
    
    await botHandler.init();
    console.log('✅ Bot initialized successfully via manual request');
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
    
    // Create a fake message
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
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ 
        status: 'ERROR', 
        message: 'URL is required',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('🔗 Manually setting webhook URL:', url);
    const result = await botHandler.bot.setWebHook(url);
    console.log('✅ Webhook set successfully:', result);
    
    res.json({ 
      status: 'OK', 
      message: 'Webhook URL set successfully',
      url: url,
      result: result,
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

// Health check endpoint
app.get('/health', (req, res) => {
  // Check if user wants HTML or JSON
  const acceptsHtml = req.accepts('html');
  
  if (acceptsHtml) {
    // Return stylized HTML page using template
    const dbStatus = database.getConnectionStatus() ? 'Connected' : 'Disconnected';
    const dbStatusClass = database.getConnectionStatus() ? 'status-ok' : 'status-error';
    
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
      database: database.getConnectionStatus() ? 'Connected' : 'Disconnected',
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

// Export the app for Vercel
module.exports = app;

// ---------- Webhook Setup ----------
async function setupWebhook() {
  try {
    // Only set webhook in production (Vercel)
    if (process.env.NODE_ENV === 'production') {
      // Use the correct fixed webhook URL
      const webhookUrl = 'https://the-tweater-theta.vercel.app/webhook';
      
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

// ---------- Initialize Everything ----------
async function initialize() {
  try {
    // In production (Vercel), skip full initialization to reduce cold start time
    // Initialization will happen on first webhook call
    if (process.env.NODE_ENV === 'production') {
      console.log('🔧 Production mode: Lazy initialization (will init on first request)');
      // Don't wait for database or bot init - let them initialize on first request
      // This makes cold starts much faster
      console.log('✅ Server ready (fast cold start)');
    } else {
      // Local development: full initialization
      console.log('🔧 Connecting to database...');
      await database.connect();
      
      // Initialize bot handler
      await initializeBot();
      
      // Set up webhook
      await setupWebhook();
      
      console.log('✅ All systems initialized successfully');
    }
  } catch (error) {
    console.error('❌ Failed to initialize:', error);
    // Don't exit in production (Vercel) - let the function continue
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }
}

// Initialize everything
initialize();

// For local development, start the server
if (process.env.NODE_ENV !== 'production') {
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
      await botHandler.bot.deleteWebHook();
      console.log('✅ Webhook deleted');
    } else {
      botHandler.bot.stopPolling();
      console.log('✅ Polling stopped');
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
      await botHandler.bot.deleteWebHook();
      console.log('✅ Webhook deleted');
    } else {
      botHandler.bot.stopPolling();
      console.log('✅ Polling stopped');
    }
    await botHandler.stop();
    await database.disconnect();
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
  process.exit(0);
});
