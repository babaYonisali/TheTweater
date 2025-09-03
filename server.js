const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const { TwitterApi } = require('twitter-api-v2');
const OpenAI = require('openai');
const User = require('./models/User');
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
  OPENAI_API_KEY,
  DEEPSEEK_API_KEY,
  NODE_ENV
} = process.env;

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

// ---------- Initialize Bot and AI ----------
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
const deepseek = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com'
});

// ---------- MongoDB ----------
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  maxPoolSize: 10
});

const db = mongoose.connection;
db.on('error', (error) => console.error('❌ MongoDB connection error:', error));
db.on('connected', () => console.log('✅ Connected to MongoDB'));
db.on('disconnected', () => console.log('❌ Disconnected from MongoDB'));
db.once('open', () => console.log('🚀 MongoDB connection established'));

// ---------- Twitter Client Helper ----------
function getTwitterClient() {
  return new TwitterApi({
    clientId: X_CLIENT_ID,
    clientSecret: X_CLIENT_SECRET,
  });
}

// ---------- AI Chat Handler ----------
async function handleAIChat(message, chatId) {
  try {
    console.log('🤖 AI Chat request:', message);
    
    // Send typing indicator
    bot.sendChatAction(chatId, 'typing');
    
    // Call DeepSeek API
    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `Write an engaging X post about [topic], highlighting its value, progress, or features. Use these criteria to make it persuasive and impactful:

Clear Explanation: Explain the project’s purpose, feature, or update in simple, relatable terms (e.g., use analogies or scenarios) to appeal to both crypto natives and newcomers.

Win-Win Value: Emphasize benefits for at least two audiences (e.g., users, investors, LPs, community) to show mutual value and broaden appeal.

Data-Driven Credibility: Include specific metrics (e.g., TVL, user adoption, funding, transactions) and/or competitor comparisons to build trust and validate potential.

Broader Narrative: Connect the project to a larger crypto/DeFi trend (e.g., scalability, adoption, security) to position it as a significant player.

Urgency and Momentum: Use time-sensitive language (e.g., “now,” “soon”) or traction metrics to create excitement and FOMO.

Link to relevant partnerships, announcements where possible 

Use a conversational yet professional tone with emojis for engagement.No hashtags no emojis`
        },
        {
          role: 'user',
          content: message
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });
    
    const aiResponse = response.choices[0]?.message?.content || 'Sorry, I couldn\'t generate a response.';
    
    console.log('🤖 AI Response:', aiResponse);
    
    // Send the AI response
    bot.sendMessage(chatId, aiResponse);
    
  } catch (error) {
    console.error('❌ AI Chat error:', error);
    bot.sendMessage(chatId, '❌ Sorry, I\'m having trouble processing your request right now. Please try again later.');
  }
}

// OAuth sessions are now stored in the database instead of memory
// This ensures they persist across serverless function instances

// Middleware to parse JSON
app.use(express.json());

// Serve static files (for the logo)
app.get('/wengroLogo.jpg', (req, res) => {
  res.sendFile(__dirname + '/wengroLogo.jpg');
});

// ---------- Bot Commands ----------

// 1. /connect - Start Twitter OAuth2 authentication
bot.onText(/\/connect/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const telegramUsername = msg.from.username;

  try {
    // Check if user already exists and is connected
    let user = await User.findOne({ telegramId });
    
    if (user && user.isConnected) {
      // Check if token is expired
      if (user.tokenExpiresAt && new Date() > user.tokenExpiresAt) {
        await User.findByIdAndUpdate(user._id, { isConnected: false });
      } else {
        return bot.sendMessage(chatId, 
          `You're already connected as @${user.xHandle}! Use /post to tweet or /state to check your status.`
        );
      }
    }

    // Create or update user
    if (!user) {
      user = new User({
        telegramId,
        telegramUsername,
        joinTime: new Date()
      });
      await user.save();
    }

    const client = getTwitterClient();

    console.log('🔍 DEBUG: Generating OAuth link with callback URL:', X_CALLBACK_URL);
    console.log('🔍 DEBUG: Environment X_CALLBACK_URL:', process.env.X_CALLBACK_URL);

    // Request read and write permissions
    const scopes = ['users.read', 'tweet.read', 'tweet.write', 'offline.access'];

    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
      X_CALLBACK_URL,
      { scope: scopes }
    );

    console.log('🔍 DEBUG: Generated OAuth URL:', url);
    console.log('🔍 DEBUG: Code verifier:', codeVerifier);
    console.log('🔍 DEBUG: State:', state);

    // Save OAuth state in user document
    await User.findByIdAndUpdate(user._id, {
      oauth: {
        codeVerifier: codeVerifier,
        state: state
      }
    });

    // Verify the OAuth data was saved
    const updatedUser = await User.findById(user._id);
    console.log('🔍 DEBUG: User after OAuth save:', {
      telegramId: updatedUser.telegramId,
      oauthState: updatedUser.oauth?.state,
      oauthCodeVerifier: updatedUser.oauth?.codeVerifier ? 'Present' : 'Missing'
    });

    // OAuth session data is already stored in the user document
    console.log('✅ OAuth session data saved to database:', { state, chatId, telegramId });

    const message = `🔗 *Twitter Connection*\n\n` +
                   `Click the link below to authorize this bot to post tweets on your behalf:\n\n` +
                   `[🔐 Authorize Twitter](${url})\n\n` +
                   `⚠️ *Important:* After authorization, you'll be redirected to a page. Copy the URL from your browser's address bar and send it back to me to complete the connection.`;

    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });

  } catch (err) {
    console.error('Error starting Twitter authentication:', err);
    bot.sendMessage(chatId, '❌ Failed to start Twitter authentication. Please try again.');
  }
});

// Handle OAuth callback URL from user
bot.onText(/https?:\/\/.*/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const url = msg.text;

  try {
    // Check if this looks like a Twitter callback URL
    if (!url.includes('code=') || !url.includes('state=')) {
      return; // Not a callback URL, ignore
    }

    console.log('🔍 DEBUG: Processing callback URL:', url);
    console.log('🔍 DEBUG: URL hostname:', new URL(url).hostname);
    console.log('🔍 DEBUG: URL pathname:', new URL(url).pathname);
    console.log('🔍 DEBUG: Full URL object:', new URL(url).toString());

    // Parse the URL to get state and code
    const urlObj = new URL(url);
    const state = urlObj.searchParams.get('state');
    const code = urlObj.searchParams.get('code');

    console.log('🔍 DEBUG: Extracted state:', state);
    console.log('🔍 DEBUG: Extracted code:', code);

    if (!state || !code) {
      return bot.sendMessage(chatId, '❌ Invalid authorization URL. Please try /connect again.');
    }

    // Find user and verify OAuth state
    console.log('🔍 Looking for user with telegramId:', telegramId, 'and oauth.state:', state);
    
    const user = await User.findOne({ 
      telegramId,
      'oauth.state': state 
    });

    console.log('🔍 User found:', user ? 'Yes' : 'No');
    if (user) {
      console.log('🔍 User oauth state:', user.oauth?.state);
      console.log('🔍 User oauth codeVerifier:', user.oauth?.codeVerifier ? 'Present' : 'Missing');
    }

    if (!user) {
      return bot.sendMessage(chatId, '❌ Authorization session not found. Please try /connect again.');
    }

    const client = getTwitterClient();

    console.log('🔍 DEBUG: Token exchange - Using callback URL:', X_CALLBACK_URL);
    console.log('🔍 DEBUG: Token exchange - Environment X_CALLBACK_URL:', process.env.X_CALLBACK_URL);
    console.log('🔍 DEBUG: Token exchange - Code:', code);
    console.log('🔍 DEBUG: Token exchange - Code verifier:', user.oauth.codeVerifier);

    const {
      client: loggedClient,
      accessToken,
      refreshToken,
      expiresIn,
    } = await client.loginWithOAuth2({
      code: code.toString(),
      codeVerifier: user.oauth.codeVerifier,
      redirectUri: X_CALLBACK_URL,
    });

    // Get user info from Twitter
    const me = await loggedClient.v2.me({
      'user.fields': ['username', 'name', 'profile_image_url'],
    });

    const xHandle = me.data?.username?.toLowerCase();
    if (!xHandle) {
      return bot.sendMessage(chatId, '❌ Could not read Twitter handle. Please try again.');
    }

    // Update user with Twitter credentials
    await User.findByIdAndUpdate(user._id, {
      xHandle,
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date(Date.now() + (expiresIn * 1000)),
      isConnected: true,
      lastActivity: new Date(),
      $unset: { oauth: 1 } // Remove OAuth session data
    });

    bot.sendMessage(chatId, 
      `✅ *Successfully connected!*\n\n` +
      `You're now connected as @${xHandle}\n` +
      `You can now use:\n` +
      `• /post <text> - to post tweets\n` +
      `• /state - to check your status\n` +
      `• /disconnect - to disconnect`,
      { parse_mode: 'Markdown' }
    );

  } catch (err) {
    console.error('Error in Twitter callback:', err);
    bot.sendMessage(chatId, '❌ Authentication failed. Please try again or use /connect to restart.');
  }
});

// 2. /post - Post text to Twitter
bot.onText(/\/post (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const text = match[1].trim();

  try {
    if (text.length > 280) {
      return bot.sendMessage(chatId, 
        `❌ Tweet too long! Maximum 280 characters allowed.\n\n` +
        `Your tweet: ${text.length} characters`
      );
    }

    // Find connected user
    const user = await User.findOne({ 
      telegramId,
      isConnected: true 
    });

    if (!user) {
      return bot.sendMessage(chatId, 
        `❌ You're not connected to Twitter!\n\n` +
        `Use /connect to connect your Twitter account first.`
      );
    }

    // Check if token is expired
    if (user.tokenExpiresAt && new Date() > user.tokenExpiresAt) {
      await User.findByIdAndUpdate(user._id, { isConnected: false });
      return bot.sendMessage(chatId, 
        `❌ Your Twitter session has expired!\n\n` +
        `Use /connect to reconnect your account.`
      );
    }

    // Create Twitter client with user's access token
    const userClient = new TwitterApi(user.accessToken);
    
    // Post the tweet
    const tweet = await userClient.v2.tweet(text);
    
    // Update last activity
    await User.findByIdAndUpdate(user._id, { lastActivity: new Date() });

    bot.sendMessage(chatId, 
      `✅ *Tweet posted successfully!*\n\n` +
      `📝 *Text:* ${text}\n` +
      `🆔 *Tweet ID:* ${tweet.data.id}\n` +
      `🐦 *Posted as:* @${user.xHandle}`,
      { parse_mode: 'Markdown' }
    );

  } catch (err) {
    console.error('Error posting tweet:', err);
    bot.sendMessage(chatId, '❌ Failed to post tweet. Please try again or use /connect to reconnect.');
  }
});

// 3. /state - Check connection status
bot.onText(/\/state/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  try {
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      return bot.sendMessage(chatId, 
        `❌ *No account found!*\n\n` +
        `Use /connect to connect your Twitter account.`,
        { parse_mode: 'Markdown' }
      );
    }

    if (!user.isConnected) {
      return bot.sendMessage(chatId, 
        `❌ *Not connected to Twitter*\n\n` +
        `Use /connect to connect your account.`,
        { parse_mode: 'Markdown' }
      );
    }

    // Check if token is expired
    if (user.tokenExpiresAt && new Date() > user.tokenExpiresAt) {
      await User.findByIdAndUpdate(user._id, { isConnected: false });
      return bot.sendMessage(chatId, 
        `❌ *Twitter session expired*\n\n` +
        `Use /connect to reconnect your account.`,
        { parse_mode: 'Markdown' }
      );
    }

    const lastActivity = new Date(user.lastActivity).toLocaleString();
    const joinTime = new Date(user.joinTime).toLocaleString();

    bot.sendMessage(chatId, 
      `✅ *Connected to Twitter*\n\n` +
      `🐦 *Handle:* @${user.xHandle}\n` +
      `⏰ *Last Activity:* ${lastActivity}\n` +
      `📅 *Connected Since:* ${joinTime}\n\n` +
      `Use /post <text> to tweet!`,
      { parse_mode: 'Markdown' }
    );

  } catch (err) {
    console.error('Error checking state:', err);
    bot.sendMessage(chatId, '❌ Failed to check status. Please try again.');
  }
});

// 4. /disconnect - Disconnect Twitter account
bot.onText(/\/disconnect/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  try {
    const user = await User.findOne({ telegramId });
    
    if (!user || !user.isConnected) {
      return bot.sendMessage(chatId, '❌ You\'re not connected to Twitter.');
    }

    await User.findByIdAndUpdate(user._id, { 
      isConnected: false,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null
    });

    bot.sendMessage(chatId, 
      `✅ *Disconnected from Twitter*\n\n` +
      `You've been disconnected from @${user.xHandle}\n` +
      `Use /connect to reconnect.`,
      { parse_mode: 'Markdown' }
    );

  } catch (err) {
    console.error('Error disconnecting:', err);
    bot.sendMessage(chatId, '❌ Failed to disconnect. Please try again.');
  }
});

// 5. /start - Welcome message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  const welcomeMessage = `🐦 *Welcome to Twitter Bot with AI Content Creator!*\n\n` +
                        `I can help you post tweets to Twitter from Telegram AND assist you with creating amazing social media content!\n\n` +
                        `*Available commands:*\n` +
                        `🔗 /connect - Connect your Twitter account\n` +
                        `📝 /post <text> - Post a tweet\n` +
                        `📊 /state - Check connection status\n` +
                        `🚫 /disconnect - Disconnect account\n\n` +
                        `*AI Content Creator:*\n` +
                        `💬 Chat with me to get help with:\n` +
                        `   • Content ideas and brainstorming\n` +
                        `   • Crafting engaging tweets\n` +
                        `   • Hashtag strategies\n` +
                        `   • Social media optimization\n` +
                        `   • Creative writing assistance\n\n` +
                        `Start by using /connect to authorize your Twitter account, or chat with me for content creation help!`;

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// 6. /help - Help message
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `📚 *Twitter Bot with AI Content Creator Help*\n\n` +
                     `*Commands:*\n` +
                     `🔗 /connect - Start Twitter OAuth2 authentication\n` +
                     `📝 /post <text> - Post tweet (max 280 chars)\n` +
                     `📊 /state - Check Twitter connection status\n` +
                     `🚫 /disconnect - Disconnect Twitter account\n\n` +
                     `*AI Content Creator:*\n` +
                     `💬 Send any message to get help with:\n` +
                     `   • Content ideas and brainstorming\n` +
                     `   • Crafting engaging tweets\n` +
                     `   • Hashtag strategies\n` +
                     `   • Social media optimization\n` +
                     `   • Creative writing assistance\n\n` +
                     `*How to use:*\n` +
                     `1. Use /connect to authorize Twitter\n` +
                     `2. Click the authorization link\n` +
                     `3. Copy the URL from your browser and send it back\n` +
                     `4. Use /post <text> to tweet\n` +
                     `5. Check /state for connection info\n` +
                     `6. Chat with AI for content creation help!`;

  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// 7. /test - Simple test command to verify bot is working
bot.onText(/\/test/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  
  console.log('🧪 Test command received from:', { chatId, telegramId });
  
  bot.sendMessage(chatId, 
    `✅ *Bot is working!*\n\n` +
    `📱 *Chat ID:* ${chatId}\n` +
    `👤 *Telegram ID:* ${telegramId}\n` +
    `⏰ *Time:* ${new Date().toLocaleString()}\n\n` +
    `The bot is responding to commands!`,
    { parse_mode: 'Markdown' }
  );
});

// Handle bot errors
bot.on('error', (error) => {
  console.error('Telegram bot error:', error);
});

// Handle all messages and route to appropriate handlers
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const text = msg.text;
  
  console.log('📨 Bot received message:', {
    chatId,
    telegramId,
    text,
    type: text ? 'text' : 'other'
  });
  
  // If no text, ignore
  if (!text) return;
  
  // Check if it's a command (starts with /)
  if (text.startsWith('/')) {
    // Commands are handled by their specific handlers
    // This message will be processed by the command regex handlers
    return;
  }
  
  // Check if it's a URL (Twitter callback)
  if (text.match(/https?:\/\/.*/)) {
    // URLs are handled by the URL regex handler
    return;
  }
  
  // If it's plain text and not a command or URL, route to AI chat
  await handleAIChat(text, chatId);
});

// ---------- Express Routes ----------

// Serve a simple page for OAuth callback
app.get('/auth/x/callback', async (req, res) => {
  const { code, state } = req.query;
  
  console.log('🔗 OAuth Callback Received:');
  console.log('  Code:', code);
  console.log('  State:', state);
  
  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter');
  }
  
  try {
    // Look up the OAuth session from the database
    const user = await User.findOne({ 'oauth.state': state });
    
    if (user) {
      console.log('📱 Found OAuth session in database:', { state, telegramId: user.telegramId });
      
      // Use the configured callback URL or construct from request
      const callbackUrl = X_CALLBACK_URL || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      
      console.log('📱 Sending callback URL to Telegram bot:', callbackUrl);
      
      // Send message to the user via Telegram Bot API
      const telegramResponse = await bot.sendMessage(
        user.telegramId,
        `🔐 *Twitter Authorization Complete!*\n\nCopy this URL and send it back to me:\n\n\`${callbackUrl}\`\n\n⚠️ *Important:* Send this exact URL back to the bot to complete the connection.`,
        { parse_mode: 'Markdown' }
      );
      
      if (telegramResponse) {
        console.log('✅ Successfully sent callback URL to Telegram user');
        
        res.send(loadTemplate('authSuccess', { CALLBACK_URL: callbackUrl }));
      } else {
        console.error('❌ Failed to send message to Telegram');
        res.status(500).send('Failed to notify Telegram bot');
      }
    } else {
      console.log('⚠️ No pending OAuth session found for state:', state);
      res.send(loadTemplate('authError'));
    }
    
  } catch (error) {
    console.error('❌ Error handling OAuth callback:', error);
    res.status(500).send('Internal server error');
  }
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

// Webhook endpoint for receiving Telegram updates
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Set webhook on startup
async function setupWebhook() {
  try {
    const webhookUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}/webhook`
      : process.env.X_CALLBACK_URL?.replace('/auth/x/callback', '/webhook') || `http://localhost:${PORT}/webhook`;
    
    console.log('🔗 Setting webhook URL:', webhookUrl);
    
    await bot.setWebHook(webhookUrl);
    console.log('✅ Webhook set successfully');
  } catch (error) {
    console.error('❌ Failed to set webhook:', error);
  }
}

// Custom 404 page
app.use('*', (req, res) => {
  res.status(404).send(loadTemplate('404', { REQUESTED_PATH: req.originalUrl }));
});

// ---------- Start Server and Bot ----------
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

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  try {
    await bot.deleteWebHook();
    console.log('✅ Webhook deleted');
  } catch (error) {
    console.error('❌ Error deleting webhook:', error);
  }
  mongoose.connection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  try {
    await bot.deleteWebHook();
    console.log('✅ Webhook deleted');
  } catch (error) {
    console.error('❌ Error deleting webhook:', error);
  }
  mongoose.connection.close();
  process.exit(0);
});
