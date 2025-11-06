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
            
            // CRITICAL: Ensure bot is initialized before processing
            if (!this.isInitialized || !this.bot) {
                console.error('❌ Bot not initialized in handleWebhookUpdate');
                console.error('❌ Bot state:', {
                    isInitialized: this.isInitialized,
                    botExists: !!this.bot
                });
                
                // Try to initialize if not already initialized
                if (!this.isInitialized) {
                    console.log('🔄 Attempting to initialize bot...');
                    try {
                        await this.init();
                        console.log('✅ Bot initialized successfully');
                    } catch (initError) {
                        console.error('❌ Failed to initialize bot:', initError);
                        
                        // Try to send error message to user if we have chat info
                        if (update.message?.chat?.id && this.bot) {
                            try {
                                await this.bot.sendMessage(
                                    update.message.chat.id,
                                    '⚠️ Bot is initializing. Please try again in a moment.'
                                );
                            } catch (sendError) {
                                console.error('❌ Failed to send initialization error:', sendError);
                            }
                        }
                        return;
                    }
                } else {
                    // Bot marked as initialized but instance is null
                    console.error('❌ Bot marked as initialized but bot instance is null');
                    return;
                }
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
            console.error('Error stack:', error.stack);
            
            // Try to send error message to user if possible
            try {
                if (this.bot && update?.message?.chat?.id) {
                    await this.bot.sendMessage(
                        update.message.chat.id,
                        '❌ An error occurred processing your message. Please try again.'
                    );
                }
            } catch (sendError) {
                console.error('❌ Failed to send error message to user:', sendError);
            }
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
        const chatId = msg?.chat?.id;
        
        if (!chatId) {
            console.error('Invalid message format in handleStartCommand:', msg);
            return;
        }
        
        try {
            if (!this.bot) {
                console.error('❌ Bot not initialized in handleStartCommand');
                console.error('❌ Bot state:', {
                    isInitialized: this.isInitialized,
                    botExists: !!this.bot,
                    deepseekExists: !!this.deepseek,
                    twitterClientExists: !!this.twitterClient
                });
                // Try to send error message if bot exists but wasn't initialized
                if (this.bot) {
                    await this.bot.sendMessage(chatId, '❌ Bot is not properly initialized. Please try again in a moment.');
                }
                return;
            }
            
            this.logUserMessage(msg, '/start');
            
            const welcomeMessage = `🐦 *Welcome to Twitter Bot with AI Tweet Generator!*\n\n` +
                                `I can help you generate tweets from long-form text and post them to Twitter!\n\n` +
                                `*Available commands:*\n` +
                                `🔗 /connect - Connect your Twitter account\n` +
                                `📝 /post <text> - Post a tweet\n` +
                                `📊 /state - Check connection status\n` +
                                `🚫 /disconnect - Disconnect account\n\n` +
                                `*AI Tweet Generator:*\n` +
                                `💬 Send me any long-form text and I'll create 3-4 engaging tweets for you!\n` +
                                `   • Paste your article, blog post, or content\n` +
                                `   • I'll analyze it and generate multiple tweet options\n` +
                                `   • Each tweet will be optimized for Twitter\n` +
                                `   • Copy and use /post to publish any tweet\n\n` +
                                `Start by using /connect to authorize your Twitter account, then send me your long-form content!`;

            const options = { parse_mode: 'Markdown' };
            if (msg.message_thread_id) {
                options.message_thread_id = msg.message_thread_id;
                console.log('🔧 Using message_thread_id:', msg.message_thread_id);
            } else {
                console.log('⚠️ No message_thread_id found');
            }
            console.log('🔧 Send options:', options);
            await this.bot.sendMessage(chatId, welcomeMessage, options);
        } catch (error) {
            console.error('Error handling /start command:', error);
            // Try to send error message to user
            try {
                if (this.bot && chatId) {
                    await this.bot.sendMessage(chatId, 
                        '❌ *Error*\n\n' +
                        'Unable to process your request right now. Please try again in a moment.',
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (sendError) {
                console.error('Failed to send error message:', sendError);
            }
        }
    }

    async handleConnectCommand(msg) {
        const chatId = msg?.chat?.id;
        const telegramId = msg?.from?.id;
        const telegramUsername = msg?.from?.username;
        
        if (!chatId || !telegramId) {
            console.error('Invalid message format in handleConnectCommand:', msg);
            return;
        }
        
        try {
            this.logUserMessage(msg, '/connect');

            // Ensure database connection
            const dbConnected = await this.ensureDatabaseConnection();
            if (!dbConnected) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database temporarily unavailable*\n\n` +
                    `Unable to process your request right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg.message_thread_id 
                    }
                );
                return;
            }

            // Check if user already exists and is connected
            let user = await User.findOne({ telegramId });
            
            if (user && user.isConnected) {
                // Check if token is expired
                if (user.tokenExpiresAt && new Date() > user.tokenExpiresAt) {
                    await User.findByIdAndUpdate(user._id, { isConnected: false });
                } else {
                    await this.bot.sendMessage(chatId, 
                        `You're already connected as @${user.xHandle}! Use /post to tweet or /state to check your status.`,
                        { message_thread_id: msg.message_thread_id }
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
                disable_web_page_preview: true,
                message_thread_id: msg.message_thread_id
            });

        } catch (error) {
            console.error('Error handling /connect command:', error);
            
            // Check if error is database-related
            if (error.name === 'MongooseError' || error.name === 'MongoServerSelectionError' || error.message?.includes('buffering timed out')) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database connection error*\n\n` +
                    `Unable to process your request right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg?.message_thread_id 
                    }
                );
            } else {
                await this.sendErrorMessage(chatId, 'Failed to start Twitter authentication. Please try again.', msg);
            }
        }
    }

    async handleUrlMessage(msg) {
        const chatId = msg?.chat?.id;
        const telegramId = msg?.from?.id;
        const url = msg?.text;
        
        if (!chatId || !telegramId || !url) {
            console.error('Invalid message format in handleUrlMessage:', msg);
            return;
        }
        
        try {
            this.logUserMessage(msg, 'URL callback');

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

            // Ensure database connection
            const dbConnected = await this.ensureDatabaseConnection();
            if (!dbConnected) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database temporarily unavailable*\n\n` +
                    `Unable to complete authentication right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg.message_thread_id 
                    }
                );
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
            
            // Check if error is database-related
            if (error.name === 'MongooseError' || error.name === 'MongoServerSelectionError' || error.message?.includes('buffering timed out')) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database connection error*\n\n` +
                    `Unable to complete authentication right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg?.message_thread_id 
                    }
                );
            } else {
                await this.sendErrorMessage(chatId, 'Authentication failed. Please try again or use /connect to restart.', msg);
            }
        }
    }

    async handlePostCommand(msg, text) {
        const chatId = msg?.chat?.id;
        const telegramId = msg?.from?.id;
        
        if (!chatId || !telegramId) {
            console.error('Invalid message format in handlePostCommand:', msg);
            return;
        }
        
        try {
            this.logUserMessage(msg, '/post');

            if (text.length > 280) {
                await this.bot.sendMessage(chatId, 
                    `❌ Tweet too long! Maximum 280 characters allowed.\n\n` +
                    `Your tweet: ${text.length} characters`
                );
                return;
            }

            // Ensure database connection
            const dbConnected = await this.ensureDatabaseConnection();
            if (!dbConnected) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database temporarily unavailable*\n\n` +
                    `Unable to post your tweet right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg.message_thread_id 
                    }
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
            
            // Check if error is database-related
            if (error.name === 'MongooseError' || error.name === 'MongoServerSelectionError' || error.message?.includes('buffering timed out')) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database connection error*\n\n` +
                    `Unable to post your tweet right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg?.message_thread_id 
                    }
                );
            } else {
                await this.sendErrorMessage(chatId, 'Failed to post tweet. Please try again or use /connect to reconnect.', msg);
            }
        }
    }

    async handleStateCommand(msg) {
        // Extract chatId early to ensure it's available in catch block
        const chatId = msg?.chat?.id;
        const telegramId = msg?.from?.id;
        
        if (!chatId || !telegramId) {
            console.error('Invalid message format in handleStateCommand:', msg);
            return;
        }
        
        try {
            this.logUserMessage(msg, '/state');
            
            // Debug logging
            console.log('🔧 State command - message_thread_id:', msg.message_thread_id);
            console.log('🔧 State command - is_topic_message:', msg.is_topic_message);

            // Check database connection before querying
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState !== 1) {
                console.warn('⚠️ Database not connected, attempting to reconnect...');
                try {
                    const database = require('../config/database');
                    await database.connect();
                } catch (dbError) {
                    console.error('❌ Database connection failed:', dbError.message);
                    await this.bot.sendMessage(chatId, 
                        `⚠️ *Database temporarily unavailable*\n\n` +
                        `Please try again in a moment.\n` +
                        `If the problem persists, check your MongoDB Atlas IP whitelist settings.`,
                        { 
                            parse_mode: 'Markdown',
                            message_thread_id: msg.message_thread_id 
                        }
                    );
                    return;
                }
            }

            const user = await User.findOne({ telegramId });
            
            if (!user) {
                await this.bot.sendMessage(chatId, 
                    `❌ *No account found!*\n\n` +
                    `Use /connect to connect your Twitter account.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg.message_thread_id 
                    }
                );
                return;
            }

            if (!user.isConnected) {
                await this.bot.sendMessage(chatId, 
                    `❌ *Not connected to Twitter*\n\n` +
                    `Use /connect to connect your account.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg.message_thread_id 
                    }
                );
                return;
            }

            // Check if token is expired
            if (user.tokenExpiresAt && new Date() > user.tokenExpiresAt) {
                await User.findByIdAndUpdate(user._id, { isConnected: false });
                await this.bot.sendMessage(chatId, 
                    `❌ *Twitter session expired*\n\n` +
                    `Use /connect to reconnect your account.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg.message_thread_id 
                    }
                );
                return;
            }

            const lastActivity = new Date(user.lastActivity).toLocaleString();
            const joinTime = new Date(user.joinTime).toLocaleString();

            const options = { parse_mode: 'Markdown' };
            if (msg.message_thread_id) {
                options.message_thread_id = msg.message_thread_id;
            }
            console.log('🔧 State command - Final options:', options);
            
            await this.bot.sendMessage(chatId, 
                `✅ *Connected to Twitter*\n\n` +
                `🐦 *Handle:* @${user.xHandle}\n` +
                `⏰ *Last Activity:* ${lastActivity}\n` +
                `📅 *Connected Since:* ${joinTime}\n\n` +
                `Use /post <text> to tweet!`,
                options
            );

        } catch (error) {
            console.error('Error handling /state command:', error);
            
            // Check if error is database-related
            if (error.name === 'MongooseError' || error.name === 'MongoServerSelectionError' || error.message?.includes('buffering timed out')) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database connection error*\n\n` +
                    `Unable to check your status right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg?.message_thread_id 
                    }
                );
            } else {
                await this.sendErrorMessage(chatId, 'Failed to check status. Please try again.', msg);
            }
        }
    }

    async handleDisconnectCommand(msg) {
        const chatId = msg?.chat?.id;
        const telegramId = msg?.from?.id;
        
        if (!chatId || !telegramId) {
            console.error('Invalid message format in handleDisconnectCommand:', msg);
            return;
        }
        
        try {
            this.logUserMessage(msg, '/disconnect');

            // Ensure database connection
            const dbConnected = await this.ensureDatabaseConnection();
            if (!dbConnected) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database temporarily unavailable*\n\n` +
                    `Unable to disconnect right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg.message_thread_id 
                    }
                );
                return;
            }

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
            
            // Check if error is database-related
            if (error.name === 'MongooseError' || error.name === 'MongoServerSelectionError' || error.message?.includes('buffering timed out')) {
                await this.bot.sendMessage(chatId, 
                    `⚠️ *Database connection error*\n\n` +
                    `Unable to disconnect right now.\n` +
                    `Please try again in a moment.\n\n` +
                    `If this persists, check your MongoDB Atlas IP whitelist settings.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: msg?.message_thread_id 
                    }
                );
            } else {
                await this.sendErrorMessage(chatId, 'Failed to disconnect. Please try again.', msg);
            }
        }
    }

    async handleHelpCommand(msg) {
        try {
            this.logUserMessage(msg, '/help');
            const chatId = msg.chat.id;
            
            const helpMessage = `📚 *Twitter Bot with AI Tweet Generator Help*\n\n` +
                             `*Commands:*\n` +
                             `🔗 /connect - Start Twitter OAuth2 authentication\n` +
                             `📝 /post <text> - Post tweet (max 280 chars)\n` +
                             `📊 /state - Check Twitter connection status\n` +
                             `🚫 /disconnect - Disconnect Twitter account\n\n` +
                             `*AI Tweet Generator:*\n` +
                             `💬 Send any long-form text to generate 3-4 tweets:\n` +
                             `   • Paste your article, blog post, or content\n` +
                             `   • I'll analyze and create multiple tweet options\n` +
                             `   • Each tweet is optimized for Twitter (under 280 chars)\n` +
                             `   • Copy any tweet and use /post to publish it\n\n` +
                             `*How to use:*\n` +
                             `1. Use /connect to authorize Twitter\n` +
                             `2. Click the authorization link\n` +
                             `3. Copy the URL from your browser and send it back\n` +
                             `4. Send me your long-form text to generate tweets\n` +
                             `5. Copy any generated tweet and use /post to publish\n` +
                             `6. Check /state for connection info`;

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
            this.logUserMessage(msg, 'AI Tweet Generation');
            const chatId = msg.chat.id;
            const message = msg.text;
            
            console.log('🤖 AI Tweet Generation request:', message);
            
            // Send typing indicator
            await this.bot.sendChatAction(chatId, 'typing');
            
            // Hard-coded pre-prompt for tweet generation
            const tweetGenerationPrompt = `You are an expert social media content creator. Your task is to analyze the provided long-form text and create 3-4 engaging, suitable tweets.

Guidelines for creating tweets:
1. Each tweet must be concise (under 280 characters)
2. Extract key ideas, insights, or highlights from the text
3. Make each tweet engaging, clear, and valuable
4. Use a conversational yet professional tone
5. Each tweet should stand alone but complement the others
6. Focus on different angles or aspects of the content
7. Use emojis sparingly and appropriately
8. Include relevant hashtags when appropriate (2-3 max per tweet)

Format your response as follows:
Tweet 1: [first tweet text]
Tweet 2: [second tweet text]
Tweet 3: [third tweet text]
Tweet 4: [fourth tweet text - optional]

If you can only create 3 high-quality tweets, that's acceptable. Always prioritize quality over quantity.`;
            
            // Call DeepSeek API
            const response = await this.deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: tweetGenerationPrompt
                    },
                    {
                        role: 'user',
                        content: `Please analyze this long-form text and create 3-4 suitable tweets:\n\n${message}`
                    }
                ],
                max_tokens: 800,
                temperature: 0.7
            });
            
            const aiResponse = response.choices[0]?.message?.content || 'Sorry, I couldn\'t generate tweets.';
            
            console.log('🤖 AI Response:', aiResponse);
            
            // Format the response for better readability
            const formattedResponse = `🐦 *Generated Tweets*\n\n${aiResponse}\n\n💡 *Tip:* You can copy any tweet and use /post to publish it!`;
            
            // Send the AI response
            await this.bot.sendMessage(chatId, formattedResponse, { 
                parse_mode: 'Markdown',
                message_thread_id: msg.message_thread_id 
            });
            
        } catch (error) {
            console.error('❌ AI Tweet Generation error:', error);
            await this.sendErrorMessage(chatId, 'Sorry, I\'m having trouble generating tweets right now. Please try again later.', msg);
        }
    }

    async handleUnknownCommand(msg) {
        try {
            console.log(`⚠️ Unrecognized command: ${msg.text}`);
            this.logUserMessage(msg, 'Unrecognized command');
            const chatId = msg.chat.id;
            await this.bot.sendMessage(chatId, 
                '❌ Unknown command. Use /help to see available commands.',
                { message_thread_id: msg.message_thread_id }
            );
        } catch (error) {
            console.error('Error handling unknown command:', error);
        }
    }

    setupCommandHandlers() {
        // Webhook mode - no polling handlers needed
        console.log('Bot configured for webhook mode - no polling handlers');
    }

    // Helper method to ensure database connection
    async ensureDatabaseConnection() {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
            return true; // Already connected
        }
        
        try {
            const database = require('../config/database');
            await database.connect();
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to database:', error.message);
            return false;
        }
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

    async sendErrorMessage(chatId, message, msg = null) {
        try {
            const options = msg && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};
            await this.bot.sendMessage(chatId, `❌ ${message}`, options);
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
