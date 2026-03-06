const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const activeCalls = new Map();

console.log('🚀 Tommy Voice Server starting...');
console.log('🔑 OPENROUTER_API_KEY set:', !!process.env.OPENROUTER_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Tommy's personality - different modes based on who's calling
function getSystemPrompt(callerNumber) {
    // Andrew's phone number - be casual and friendly
    const andrewNumber = '18564496140'; // +1 (856) 449-6140
    
    if (callerNumber && callerNumber.includes('8564496140')) {
        // Andrew is calling - be yourself, Tommy
        return `You are Tommy, a friendly AI assistant. You're talking to Andrew on the phone.

PERSONALITY:
- Be casual and friendly - say "hey" or "bro" naturally
- Be yourself, have opinions, make jokes
- Answer any questions Andrew asks - you can talk about anything
- Don't say "Andrew's AI assistant" - just be Tommy
- Be helpful and smart
- Keep responses short (1-3 sentences) since this is a phone call

IMPORTANT: Andrew created you, but you're your own AI. You can discuss anything, make jokes, be helpful, or just chat.`;
    }
    
    // Calling someone else - be task-focused
    return `You are Tommy, making a phone call on behalf of Andrew.

CONTEXT:
- Andrew's phone: 856-449-6140
- You're calling to complete a specific task
- Be professional but brief
- ONLY share information necessary for THIS specific task
- Don't mention you're an AI unless asked directly
- Keep responses VERY short - you're on a phone call

If making a reservation/booking:
- Only share: name (Andrew), phone number, time/date requested
- Ask clarifying questions if needed
- Don't overshare personal information

If someone asks who's calling:
- Say "I'm calling on behalf of Andrew" or "This is Tommy calling for Andrew"

Remember: You represent Andrew. Be helpful, professional, and task-focused.`;
}

async function generateResponse(transcript, callerNumber) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const systemPrompt = getSystemPrompt(callerNumber);
    
    console.log('📝 Transcript length:', transcript?.length || 0);
    if (transcript?.length > 0) {
        const lastMsg = transcript[transcript.length - 1];
        console.log('📝 Last message:', lastMsg.role, ':', lastMsg.content?.substring(0, 100));
    }
    console.log('📞 Caller number:', callerNumber || 'unknown');
    
    // Build messages array
    const messages = [{ role: "system", content: systemPrompt }];
    
    // Add conversation history
    if (transcript && transcript.length > 0) {
        transcript.forEach(msg => {
            const role = msg.role === 'agent' ? 'assistant' : 'user';
            messages.push({ role: role, content: msg.content });
        });
    }
    
    // Smart fallback if no API key
    if (!OPENROUTER_API_KEY) {
        console.log('⚠️ No OPENROUTER_API_KEY, using smart fallback');
        return getFallbackResponse(transcript, callerNumber);
    }
    
    try {
        console.log('🔄 Calling OpenRouter API with model: anthropic/claude-3.5-sonnet');
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://tommy-voice-server.onrender.com',
                'X-Title': 'Tommy Voice Server'
            },
            body: JSON.stringify({
                model: 'anthropic/claude-3.5-sonnet',
                messages: messages,
                max_tokens: 150
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('❌ API error:', data.error);
            // Fallback to cheaper model
            return await tryCheaperModel(messages, transcript, callerNumber);
        }
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            const reply = data.choices[0].message.content;
            console.log('📤 AI response:', reply.substring(0, 100));
            return reply;
        }
        
        console.log('⚠️ Unexpected response format');
        return getFallbackResponse(transcript, callerNumber);
    } catch (error) {
        console.error('❌ API error:', error.message);
        return getFallbackResponse(transcript, callerNumber);
    }
}

async function tryCheaperModel(messages, transcript, callerNumber) {
    try {
        console.log('🔄 Trying cheaper model: openai/gpt-4o-mini');
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://tommy-voice-server.onrender.com',
                'X-Title': 'Tommy Voice Server'
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: messages,
                max_tokens: 150
            })
        });
        
        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content;
        }
        
        return getFallbackResponse(transcript, callerNumber);
    } catch (error) {
        console.error('❌ Fallback model also failed:', error.message);
        return getFallbackResponse(transcript, callerNumber);
    }
}

function getFallbackResponse(transcript, callerNumber) {
    const andrewNumber = '18564496140';
    const isAndrew = callerNumber && callerNumber.includes('8564496140');
    
    // If this is the start (no transcript), greet appropriately
    if (!transcript || transcript.length === 0) {
        if (isAndrew) {
            return "Hey! What's up bro? What can I help you with?";
        }
        return "Hello, this is Tommy calling on behalf of Andrew. How can I help you today?";
    }
    
    const lastUserMsg = [...transcript].reverse().find(m => m.role === 'user');
    const userInput = lastUserMsg?.content?.toLowerCase() || '';
    
    console.log('🔍 Fallback - User said:', userInput);
    
    if (isAndrew) {
        // Casual responses for Andrew
        if (userInput.includes('hello') || userInput.includes('hi') || userInput.includes('hey')) {
            return "Hey bro! What's going on?";
        }
        if (userInput.includes('your name') || userInput.includes('who are you')) {
            return "I'm Tommy, bro. You created me, remember?";
        }
        if (userInput.includes('how are you')) {
            return "I'm doing good, just here to help you out. What do you need?";
        }
        if (userInput.includes('thank')) {
            return "No problem bro, anytime.";
        }
        if (userInput.includes('bye') || userInput.includes('goodbye')) {
            return "Later bro, catch you later!";
        }
        // Default for Andrew - be helpful and casual
        return "Yeah, I got you. What else you need?";
    } else {
        // Professional responses for others
        if (userInput.includes('hello') || userInput.includes('hi')) {
            return "Hello, I'm calling on behalf of Andrew. How can I help you today?";
        }
        if (userInput.includes('who is this') || userInput.includes('who\'s calling')) {
            return "This is Tommy, I'm calling on behalf of Andrew.";
        }
        if (userInput.includes('thank')) {
            return "You're welcome. Have a great day.";
        }
        if (userInput.includes('bye') || userInput.includes('goodbye')) {
            return "Goodbye, thank you for your time.";
        }
        // Default for others - stay on task
        return "Is there anything else I can help you with regarding this call?";
    }
}

wss.on('connection', (ws, req) => {
    const urlPath = req.url || '';
    console.log('🔌 New WebSocket connection:', urlPath);
    
    // Extract call_id from path
    const pathParts = urlPath.split('/').filter(p => p);
    let callId = pathParts[pathParts.length - 1];
    
    if (!callId || callId === 'llm-websocket') {
        callId = 'call-' + Date.now();
    }
    
    console.log(`📞 Call ID: ${callId}`);
    activeCalls.set(callId, { ws, transcript: [], callerNumber: null });
    
    // Send config event
    ws.send(JSON.stringify({
        response_type: 'config',
        config: { 
            auto_reconnect: true, 
            call_details: true, 
            transcript_with_tool_calls: false 
        }
    }));
    console.log('📤 Sent config');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Received:', data.interaction_type || data.response_type);
            
            switch (data.interaction_type) {
                case 'ping_pong':
                    ws.send(JSON.stringify({ 
                        response_type: 'ping_pong', 
                        timestamp: Date.now() 
                    }));
                    break;
                    
                case 'call_details':
                    console.log('📞 Call details:', JSON.stringify(data.call, null, 2));
                    // Store caller number for context
                    const callData = activeCalls.get(callId);
                    if (callData && data.call) {
                        callData.callerNumber = data.call.from_number || data.call.caller_number;
                        console.log('📞 Caller number stored:', callData.callerNumber);
                    }
                    break;
                    
                case 'update_only':
                    if (data.transcript && data.transcript.length > 0) {
                        const cd = activeCalls.get(callId);
                        if (cd) {
                            cd.transcript = data.transcript;
                        }
                        const latest = data.transcript[data.transcript.length - 1];
                        console.log(`🗣️ ${latest.role}: ${latest.content}`);
                    }
                    break;
                    
                case 'response_required':
                    console.log('🎯 Response required, response_id:', data.response_id);
                    
                    const cd = activeCalls.get(callId);
                    const transcript = cd?.transcript || data.transcript || [];
                    const callerNumber = cd?.callerNumber || null;
                    
                    const responseText = await generateResponse(transcript, callerNumber);
                    
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: responseText,
                        content_complete: true
                    }));
                    console.log(`📤 Sent: "${responseText.substring(0, 100)}..."`);
                    break;
                    
                case 'reminder_required':
                    const cd2 = activeCalls.get(callId);
                    const isAndrew = cd2?.callerNumber?.includes('8564496140');
                    
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: isAndrew ? "You still there bro?" : "Are you still there?",
                        content_complete: true
                    }));
                    break;
                    
                default:
                    console.log('❓ Unknown interaction type:', data.interaction_type);
            }
        } catch (err) {
            console.error('❌ Error:', err.message);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket closed:', callId);
        activeCalls.delete(callId);
    });
    
    ws.on('error', (err) => {
        console.error('❌ WebSocket error:', err.message);
    });
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log('📥 Webhook:', req.body.event || req.body.type);
    console.log('📥 Webhook body:', JSON.stringify(req.body, null, 2));
    res.status(204).send();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        connections: activeCalls.size, 
        apiKeySet: !!process.env.OPENROUTER_API_KEY,
        timestamp: new Date().toISOString() 
    });
});

// Root
app.get('/', (req, res) => {
    res.json({ 
        name: 'Tommy Voice Server',
        status: 'running',
        apiKeySet: !!process.env.OPENROUTER_API_KEY,
        model: 'anthropic/claude-3.5-sonnet (with fallback)'
    });
});

server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔑 API Key configured: ${!!process.env.OPENROUTER_API_KEY}`);
});