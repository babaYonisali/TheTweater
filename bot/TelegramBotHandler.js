const TelegramBot = require('node-telegram-bot-api');
const { TwitterApi } = require('twitter-api-v2');
const OpenAI = require('openai');
const User = require('../models/User');
const { loadTemplate } = require('../utils/templateLoader');
require('dotenv').config();

class TelegramBotHandler {
    constructor() {
        this.bot = null;
        this.isInitialized = false;
        this.deepseek = null;
        this.twitterClient = null;
    }

    async init() {
        try {
            console.log('🔧 Initializing Telegram bot...');
            console.log('🔍 Environment check:', {
                TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? 'Present' : 'Missing',
                DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? 'Present' : 'Missing',
                X_CLIENT_ID: process.env.X_CLIENT_ID ? 'Present' : 'Missing',
                X_CLIENT_SECRET: process.env.X_CLIENT_SECRET ? 'Present' : 'Missing',
                NODE_ENV: process.env.NODE_ENV
            });

            // Validate required environment variables
            if (!process.env.TELEGRAM_BOT_TOKEN) {
                throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
            }

            // Create bot instance (no polling for Vercel)
            this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
            console.log('✅ Telegram bot instance created');
            
            // Initialize AI client
            if (process.env.DEEPSEEK_API_KEY) {
                this.deepseek = new OpenAI({
                    apiKey: process.env.DEEPSEEK_API_KEY,
                    baseURL: 'https://api.deepseek.com'
                });
                console.log('✅ DeepSeek AI client initialized');
            } else {
                console.warn('⚠️ DEEPSEEK_API_KEY not found, AI features disabled');
            }

            // Initialize Twitter client
            if (process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET) {
                this.twitterClient = new TwitterApi({
                    clientId: process.env.X_CLIENT_ID,
                    clientSecret: process.env.X_CLIENT_SECRET,
                });
                console.log('✅ Twitter client initialized');
            } else {
                console.warn('⚠️ Twitter credentials not found, Twitter features disabled');
            }
            
            // Set up command handlers
            this.setupCommandHandlers();
            
            // Set up error handling
            this.setupErrorHandling();
            
            this.isInitialized = true;
            console.log('✅ Telegram bot initialized successfully (webhook mode)');
        } catch (error) {
            console.error('❌ Error initializing Telegram bot:', error);
            this.isInitialized = false;
            throw error;
        }
    }

    // Method to handle webhook updates
    async handleWebhookUpdate(update) {
        try {
            console.log('=== WEBHOOK UPDATE RECEIVED ===');
            console.log('Update:', JSON.stringify(update, null, 2));
            
            // Check if bot is initialized
            if (!this.isInitialized || !this.bot) {
                console.error('❌ Bot not initialized yet, ignoring update');
                return;
            }
            
            if (update.message && update.message.text) {
                const msg = update.message;
                console.log('Processing message:', msg.text);
                
                // Handle commands
                if (msg.text.startsWith('/')) {
                    await this.handleCommand(msg);
                } else if (msg.text.match(/https?:\/\/.*/)) {
                    // Handle URL (Twitter callback)
                    await this.handleUrlMessage(msg);
                } else {
                    // Handle AI chat
                    await this.handleAIChat(msg);
                }
            } else {
                console.log('No text message in update');
            }
        } catch (error) {
            console.error('Error handling webhook update:', error);
        }
    }

    async handleCommand(msg) {
        const text = msg.text;
        
        if (text === '/start') {
            await this.handleStartCommand(msg);
        } else if (text === '/connect') {
            await this.handleConnectCommand(msg);
        } else if (text.startsWith('/post ')) {
            const tweetText = text.replace('/post ', '');
            await this.handlePostCommand(msg, tweetText);
        } else if (text === '/state') {
            await this.handleStateCommand(msg);
        } else if (text === '/disconnect') {
            await this.handleDisconnectCommand(msg);
        } else if (text === '/help') {
            await this.handleHelpCommand(msg);
        } else if (text === '/test') {
            await this.handleTestCommand(msg);
        } else {
            await this.handleUnknownCommand(msg);
        }
    }

    async handleStartCommand(msg) {
        try {
            if (!this.bot) {
                console.error('❌ Bot not initialized in handleStartCommand');
                console.error('❌ Bot state:', {
                    isInitialized: this.isInitialized,
                    botExists: !!this.bot,
                    deepseekExists: !!this.deepseek,
                    twitterClientExists: !!this.twitterClient
                });
                return;
            }
            
            // Check database connection
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState !== 1) {
                console.error('❌ Database not connected, attempting to reconnect...');
                await mongoose.connect(process.env.MONGODB_URI, {
                    useNewUrlParser: true,
                    useUnifiedTopology: true,
                    serverSelectionTimeoutMS: 30000,
                    socketTimeoutMS: 45000,
                    connectTimeoutMS: 30000,
                    maxPoolSize: 10,
                    retryWrites: true,
                    w: 'majority'
                });
            }
            
            this.logUserMessage(msg, '/start');
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

            await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error handling /start command:', error);
        }
    }

    async handleConnectCommand(msg) {
        try {
            this.logUserMessage(msg, '/connect');
            const chatId = msg.chat.id;
            const telegramId = msg.from.id;
            const telegramUsername = msg.from.username;

            // Check if user already exists and is connected
            let user = await User.findOne({ telegramId });
            
            if (user && user.isConnected) {
                // Check if token is expired
                if (user.tokenExpiresAt && new Date() > user.tokenExpiresAt) {
                    await User.findByIdAndUpdate(user._id, { isConnected: false });
                } else {
                    await this.bot.sendMessage(chatId, 
                        `You're already connected as @${user.xHandle}! Use /post to tweet or /state to check your status.`
                    );
                    return;
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

            const X_CALLBACK_URL = process.env.NODE_ENV === 'production' 
                ? process.env.X_CALLBACK_URL 
                : 'http://localhost:3000/auth/x/callback';

            // Request read and write permissions
            const scopes = ['users.read', 'tweet.read', 'tweet.write', 'offline.access'];

            const { url, codeVerifier, state } = this.twitterClient.generateOAuth2AuthLink(
                X_CALLBACK_URL,
                { scope: scopes }
            );

            // Save OAuth state in user document
            await User.findByIdAndUpdate(user._id, {
                oauth: {
                    codeVerifier: codeVerifier,
                    state: state
                }
            });

            const message = `🔗 *Twitter Connection*\n\n` +
                           `Click the link below to authorize this bot to post tweets on your behalf:\n\n` +
                           `[🔐 Authorize Twitter](${url})\n\n` +
                           `⚠️ *Important:* After authorization, you'll be redirected to a page. Copy the URL from your browser's address bar and send it back to me to complete the connection.`;

            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });

        } catch (error) {
            console.error('Error handling /connect command:', error);
            await this.sendErrorMessage(chatId, 'Failed to start Twitter authentication. Please try again.');
        }
    }

    async handleUrlMessage(msg) {
        try {
            this.logUserMessage(msg, 'URL callback');
            const chatId = msg.chat.id;
            const telegramId = msg.from.id;
            const url = msg.text;

            // Check if this looks like a Twitter callback URL
            if (!url.includes('code=') || !url.includes('state=')) {
                return; // Not a callback URL, ignore
            }

            // Parse the URL to get state and code
            const urlObj = new URL(url);
            const state = urlObj.searchParams.get('state');
            const code = urlObj.searchParams.get('code');

            if (!state || !code) {
                await this.bot.sendMessage(chatId, '❌ Invalid authorization URL. Please try /connect again.');
                return;
            }

            // Find user and verify OAuth state
            const user = await User.findOne({ 
                telegramId,
                'oauth.state': state 
            });

            if (!user) {
                await this.bot.sendMessage(chatId, '❌ Authorization session not found. Please try /connect again.');
                return;
            }

            const X_CALLBACK_URL = process.env.NODE_ENV === 'production' 
                ? process.env.X_CALLBACK_URL 
                : 'http://localhost:3000/auth/x/callback';

            const {
                client: loggedClient,
                accessToken,
                refreshToken,
                expiresIn,
            } = await this.twitterClient.loginWithOAuth2({
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
                await this.bot.sendMessage(chatId, '❌ Could not read Twitter handle. Please try again.');
                return;
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

            await this.bot.sendMessage(chatId, 
                `✅ *Successfully connected!*\n\n` +
                `You're now connected as @${xHandle}\n` +
                `You can now use:\n` +
                `• /post <text> - to post tweets\n` +
                `• /state - to check your status\n` +
                `• /disconnect - to disconnect`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('Error handling URL message:', error);
            await this.sendErrorMessage(chatId, 'Authentication failed. Please try again or use /connect to restart.');
        }
    }

    async handlePostCommand(msg, text) {
        try {
            this.logUserMessage(msg, '/post');
            const chatId = msg.chat.id;
            const telegramId = msg.from.id;

            if (text.length > 280) {
                await this.bot.sendMessage(chatId, 
                    `❌ Tweet too long! Maximum 280 characters allowed.\n\n` +
                    `Your tweet: ${text.length} characters`
                );
                return;
            }

            // Find connected user
            const user = await User.findOne({ 
                telegramId,
                isConnected: true 
            });

            if (!user) {
                await this.bot.sendMessage(chatId, 
                    `❌ You're not connected to Twitter!\n\n` +
                    `Use /connect to connect your Twitter account first.`
                );
                return;
            }

            // Check if token is expired
            if (user.tokenExpiresAt && new Date() > user.tokenExpiresAt) {
                await User.findByIdAndUpdate(user._id, { isConnected: false });
                await this.bot.sendMessage(chatId, 
                    `❌ Your Twitter session has expired!\n\n` +
                    `Use /connect to reconnect your account.`
                );
                return;
            }

            // Create Twitter client with user's access token
            const userClient = new TwitterApi(user.accessToken);
            
            // Post the tweet
            const tweet = await userClient.v2.tweet(text);
            
            // Update last activity
            await User.findByIdAndUpdate(user._id, { lastActivity: new Date() });

            await this.bot.sendMessage(chatId, 
                `✅ *Tweet posted successfully!*\n\n` +
                `📝 *Text:* ${text}\n` +
                `🆔 *Tweet ID:* ${tweet.data.id}\n` +
                `🐦 *Posted as:* @${user.xHandle}`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('Error handling /post command:', error);
            await this.sendErrorMessage(chatId, 'Failed to post tweet. Please try again or use /connect to reconnect.');
        }
    }

    async handleStateCommand(msg) {
        try {
            this.logUserMessage(msg, '/state');
            const chatId = msg.chat.id;
            const telegramId = msg.from.id;

            const user = await User.findOne({ telegramId });
            
            if (!user) {
                await this.bot.sendMessage(chatId, 
                    `❌ *No account found!*\n\n` +
                    `Use /connect to connect your Twitter account.`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            if (!user.isConnected) {
                await this.bot.sendMessage(chatId, 
                    `❌ *Not connected to Twitter*\n\n` +
                    `Use /connect to connect your account.`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // Check if token is expired
            if (user.tokenExpiresAt && new Date() > user.tokenExpiresAt) {
                await User.findByIdAndUpdate(user._id, { isConnected: false });
                await this.bot.sendMessage(chatId, 
                    `❌ *Twitter session expired*\n\n` +
                    `Use /connect to reconnect your account.`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            const lastActivity = new Date(user.lastActivity).toLocaleString();
            const joinTime = new Date(user.joinTime).toLocaleString();

            await this.bot.sendMessage(chatId, 
                `✅ *Connected to Twitter*\n\n` +
                `🐦 *Handle:* @${user.xHandle}\n` +
                `⏰ *Last Activity:* ${lastActivity}\n` +
                `📅 *Connected Since:* ${joinTime}\n\n` +
                `Use /post <text> to tweet!`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('Error handling /state command:', error);
            await this.sendErrorMessage(chatId, 'Failed to check status. Please try again.');
        }
    }

    async handleDisconnectCommand(msg) {
        try {
            this.logUserMessage(msg, '/disconnect');
            const chatId = msg.chat.id;
            const telegramId = msg.from.id;

            const user = await User.findOne({ telegramId });
            
            if (!user || !user.isConnected) {
                await this.bot.sendMessage(chatId, '❌ You\'re not connected to Twitter.');
                return;
            }

            await User.findByIdAndUpdate(user._id, { 
                isConnected: false,
                accessToken: null,
                refreshToken: null,
                tokenExpiresAt: null
            });

            await this.bot.sendMessage(chatId, 
                `✅ *Disconnected from Twitter*\n\n` +
                `You've been disconnected from @${user.xHandle}\n` +
                `Use /connect to reconnect.`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('Error handling /disconnect command:', error);
            await this.sendErrorMessage(chatId, 'Failed to disconnect. Please try again.');
        }
    }

    async handleHelpCommand(msg) {
        try {
            this.logUserMessage(msg, '/help');
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

            await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error handling /help command:', error);
        }
    }

    async handleTestCommand(msg) {
        try {
            this.logUserMessage(msg, '/test');
            const chatId = msg.chat.id;
            const telegramId = msg.from.id;
            
            await this.bot.sendMessage(chatId, 
                `✅ *Bot is working!*\n\n` +
                `📱 *Chat ID:* ${chatId}\n` +
                `👤 *Telegram ID:* ${telegramId}\n` +
                `⏰ *Time:* ${new Date().toLocaleString()}\n\n` +
                `The bot is responding to commands!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Error handling /test command:', error);
        }
    }

    async handleAIChat(msg) {
        try {
            this.logUserMessage(msg, 'AI Chat');
            const chatId = msg.chat.id;
            const message = msg.text;
            
            console.log('🤖 AI Chat request:', message);
            
            // Send typing indicator
            await this.bot.sendChatAction(chatId, 'typing');
            
            // Call DeepSeek API
            const response = await this.deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `Write an engaging X post about [topic], highlighting its value, progress, or features. Use these criteria to make it persuasive and impactful:

Clear Explanation: Explain the project's purpose, feature, or update in simple, relatable terms (e.g., use analogies or scenarios) to appeal to both crypto natives and newcomers.

Win-Win Value: Emphasize benefits for at least two audiences (e.g., users, investors, LPs, community) to show mutual value and broaden appeal.

Data-Driven Credibility: Include specific metrics (e.g., TVL, user adoption, funding, transactions) and/or competitor comparisons to build trust and validate potential.

Broader Narrative: Connect the project to a larger crypto/DeFi trend (e.g., scalability, adoption, security) to position it as a significant player.

Urgency and Momentum: Use time-sensitive language (e.g., "now," "soon") or traction metrics to create excitement and FOMO.

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
            await this.bot.sendMessage(chatId, aiResponse);
            
        } catch (error) {
            console.error('❌ AI Chat error:', error);
            await this.sendErrorMessage(chatId, 'Sorry, I\'m having trouble processing your request right now. Please try again later.');
        }
    }

    async handleUnknownCommand(msg) {
        try {
            console.log(`⚠️ Unrecognized command: ${msg.text}`);
            this.logUserMessage(msg, 'Unrecognized command');
            const chatId = msg.chat.id;
            await this.bot.sendMessage(chatId, 
                '❌ Unknown command. Use /help to see available commands.'
            );
        } catch (error) {
            console.error('Error handling unknown command:', error);
        }
    }

    setupCommandHandlers() {
        // Webhook mode - no polling handlers needed
        console.log('Bot configured for webhook mode - no polling handlers');
    }

    logUserMessage(msg, command) {
        const user = msg.from;
        const chat = msg.chat;
        
        console.log('\n=== USER MESSAGE RECEIVED ===');
        console.log(`📅 Time: ${new Date().toISOString()}`);
        console.log(`💬 Command: ${command}`);
        console.log(`📝 Full Message: ${msg.text}`);
        console.log('\n👤 USER INFO:');
        console.log(`   ID: ${user.id}`);
        console.log(`   Username: @${user.username || 'N/A'}`);
        console.log(`   First Name: ${user.first_name || 'N/A'}`);
        console.log(`   Last Name: ${user.last_name || 'N/A'}`);
        console.log(`   Language: ${user.language_code || 'N/A'}`);
        console.log('\n💬 CHAT INFO:');
        console.log(`   Chat ID: ${chat.id}`);
        console.log(`   Chat Type: ${chat.type}`);
        console.log(`   Chat Title: ${chat.title || 'N/A'}`);
        console.log('================================\n');
    }

    async sendErrorMessage(chatId, message) {
        try {
            await this.bot.sendMessage(chatId, `❌ ${message}`);
        } catch (error) {
            console.error('Error sending error message:', error);
        }
    }

    setupErrorHandling() {
        this.bot.on('error', (error) => {
            console.error('Telegram bot error:', error);
        });
    }

    async stop() {
        if (this.bot) {
            console.log('Telegram bot stopped (webhook mode)');
        }
    }
}

module.exports = TelegramBotHandler;
