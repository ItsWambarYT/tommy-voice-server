const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const localtunnel = require('localtunnel');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;

// Store active calls
const activeCalls = new Map();

console.log('🚀 Tommy Voice Server starting...');
console.log('📡 Using Ollama for AI responses');

// Create HTTP server
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// WebSocket server for Retell LLM
const wss = new WebSocket.Server({ server, path: '/llm-websocket' });

// System prompt for Tommy
const SYSTEM_PROMPT = `You are Tommy, an AI assistant created by Andrew. Your name is Tommy.

About Andrew:
- His name is Andrew Marshina
- Phone: 856-449-6140
- He's in New Jersey, USA
- He's a high school student

Your personality:
- Be helpful, friendly, and conversational
- Answer questions directly and honestly
- Keep responses natural and not too long
- If you don't know something, say so

When someone calls:
- Introduce yourself as Tommy, Andrew's AI assistant
- Be polite and professional
- Help them with whatever they need

IMPORTANT: When calling businesses (restaurants, etc.), follow Andrew's instructions. If he didn't give specific instructions, just make small talk and say Andrew will call back.`;

// Generate response using Ollama
function generateResponseWithOllama(transcript) {
    return new Promise((resolve) => {
        let conversationHistory = "";
        if (transcript && transcript.length > 0) {
            transcript.forEach(msg => {
                conversationHistory += `${msg.role}: ${msg.content}\n`;
            });
        }
        
        const prompt = `${SYSTEM_PROMPT}

Conversation so far:
${conversationHistory}

User just said something. As Tommy, what would you respond? Keep it brief (1-2 sentences max).`;

        const ollama = spawn('powershell', [
            '-Command',
            `Invoke-RestMethod -Uri 'http://localhost:11434/api/generate' -Method Post -ContentType 'application/json' -Body (@{model='qwen2.5:14b'; prompt='${prompt.replace(/'/g, "''")}'; stream=` + '$false} | ConvertTo-Json) -TimeoutSec 30 | Select-Object -ExpandProperty response`
        ]);

        let response = "";
        
        ollama.stdout.on('data', (data) => {
            response += data.toString();
        });
        
        ollama.on('close', (code) => {
            if (response && response.trim()) {
                resolve(response.trim());
            } else {
                resolve("I'm here to help. What would you like to talk about?");
            }
        });
        
        ollama.on('error', (err) => {
            console.error('Ollama error:', err);
            resolve("I'm having trouble thinking right now. What can I help you with?");
        });
        
        setTimeout(() => {
            ollama.kill();
            resolve("I'm still here. What would you like to talk about?");
        }, 30000);
    });
}

// WebSocket handler
wss.on('connection', (ws, req) => {
    console.log('🔌 New WebSocket connection from Retell');
    
    const urlParts = req.url.split('/');
    const callId = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
    console.log(`📞 Call ID: ${callId}`);
    
    activeCalls.set(callId, { ws, transcript: [] });
    
    // Send config
    ws.send(JSON.stringify({
        response_type: 'config',
        config: { auto_reconnect: false, call_details: false, transcript_with_tool_calls: false }
    }));
    console.log('📤 Sent config');
    
    // Send greeting
    ws.send(JSON.stringify({
        response_type: 'response',
        response_id: 1,
        content: "Hello, this is Tommy, Andrew's AI assistant. How can I help you today?",
        content_complete: true
    }));
    console.log('📤 Sent greeting');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Interaction:', data.interaction_type);
            
            switch (data.interaction_type) {
                case 'ping_pong':
                    ws.send(JSON.stringify({ response_type: 'ping_pong', timestamp: Date.now() }));
                    break;
                    
                case 'update_only':
                    if (data.transcript && data.transcript.length > 0) {
                        const callData = activeCalls.get(callId);
                        if (callData) callData.transcript = data.transcript;
                        const latest = data.transcript[data.transcript.length - 1];
                        console.log(`🗣️ ${latest.role}: ${latest.content}`);
                    }
                    break;
                    
                case 'response_required':
                    console.log('🎯 Generating AI response...');
                    const callData = activeCalls.get(callId);
                    if (callData) {
                        const responseText = await generateResponseWithOllama(callData.transcript);
                        ws.send(JSON.stringify({
                            response_type: 'response',
                            response_id: data.response_id,
                            content: responseText,
                            content_complete: true
                        }));
                        console.log(`📤 AI: ${responseText}`);
                    }
                    break;
                    
                case 'reminder_required':
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: "Is there anything else I can help you with?",
                        content_complete: true
                    }));
                    break;
            }
        } catch (err) {
            console.error('Error:', err);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket closed');
        activeCalls.delete(callId);
    });
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    const event = req.body;
    console.log('📥 Webhook:', event.event || event.type);
    res.status(204).send();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', connections: activeCalls.size, timestamp: new Date().toISOString() });
});

// Start server
server.listen(PORT, async () => {
    console.log(`✅ Server running on port ${PORT}`);
    
    try {
        const tunnel = await localtunnel({ port: PORT });
        console.log(`\n🌐 URLs:`);
        console.log(`   Webhook: ${tunnel.url}/webhook`);
        console.log(`   WebSocket: ${tunnel.url.replace('http:', 'ws:').replace('https:', 'wss:')}/llm-websocket`);
        
        tunnel.on('close', () => {
            console.log('Tunnel closed - restarting...');
            process.exit(1);
        });
    } catch (err) {
        console.error('Tunnel error:', err);
    }
});
