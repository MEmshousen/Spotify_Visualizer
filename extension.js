const vscode = require('vscode');
const express = require('express');
const open = require('open');

let statusBarItem;
let currentPanel;
let spotifyToken = null;
let updateInterval = null;

const CLIENT_ID = 'd3320154eaa046ce9d8b4028699d528c';
const CLIENT_SECRET = 'ab48955b513643ecb0f2b0b39fbf4098';
const REDIRECT_URI = 'http://localhost:8888/callback';

function activate(context) {
    console.log('Spotify Visualizer is activating...');

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'spotify-visualizer.show';
    statusBarItem.text = '$(music) Spotify';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    let showCommand = vscode.commands.registerCommand('spotify-visualizer.show', () => {
        console.log('Show command triggered');
        if (!spotifyToken) {
            authenticateSpotify(context);
        } else {
            createVisualizerPanel(context);
        }
    });

    let loginCommand = vscode.commands.registerCommand('spotify-visualizer.login', () => {
        console.log('Login command triggered');
        authenticateSpotify(context);
    });

    context.subscriptions.push(showCommand, loginCommand);

    spotifyToken = context.globalState.get('spotifyToken');
    if (spotifyToken) {
        statusBarItem.text = '$(music) Spotify ✓';
    }

    console.log('Spotify Visualizer activated successfully');
}
function authenticateSpotify(context) {
    const app = express();
    let server;

    app.get('/callback', async (req, res) => {
        const code = req.query.code;
        
        if (code) {
            try {
                const response = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
                    },
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        code: code,
                        redirect_uri: REDIRECT_URI
                    })
                });

                const data = await response.json();
                spotifyToken = data.access_token;
                context.globalState.update('spotifyToken', spotifyToken);
                
                statusBarItem.text = '$(music) Spotify ✓';
                
                res.send('<h1>Success!</h1><p>You can close this window and return to VS Code.</p>');
                
                setTimeout(() => {
                    server.close();
                    createVisualizerPanel(context);
                }, 1000);
                
                vscode.window.showInformationMessage('Successfully connected to Spotify!');
            } catch (error) {
                res.send('<h1>Error!</h1><p>Failed to authenticate. Please try again.</p>');
                vscode.window.showErrorMessage('Spotify authentication failed');
                server.close();
            }
        }
    });

    server = app.listen(8888, () => {
        const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=(REDIRECT_URI)&scope=user-read-currently-playing user-read-playback-state`;
        open(authUrl);
        vscode.window.showInformationMessage('Opening Spotify authentication in browser...');
    });
}

function createVisualizerPanel(context) {
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.One);
        return;
    }

    currentPanel = vscode.window.createWebviewPanel(
        'spotifyVisualizer',
        'Spotify Visualizer',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    currentPanel.webview.html = getWebviewContent();

    currentPanel.webview.onDidReceiveMessage(
        async message => {
            if (message.command === 'getCurrentTrack') {
                const trackData = await fetchCurrentTrack();
                currentPanel.webview.postMessage({
                    command: 'updateTrack',
                    data: trackData
                });
            }
        },
        undefined,
        context.subscriptions
    );

    updateInterval = setInterval(async () => {
        if (currentPanel) {
            const trackData = await fetchCurrentTrack();
            currentPanel.webview.postMessage({
                command: 'updateTrack',
                data: trackData
            });
        }
    }, 2000);

    currentPanel.onDidDispose(
        () => {
            currentPanel = null;
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
        },
        null,
        context.subscriptions
    );
}

async function fetchCurrentTrack() {
    if (!spotifyToken) return null;

    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${spotifyToken}` }
        });

        if (response.status === 204) return null;

        const data = await response.json();
        
        if (data.item) {
            const featuresResponse = await fetch(`https://api.spotify.com/v1/audio-features/${data.item.id}`, {
                headers: { 'Authorization': `Bearer ${spotifyToken}` }
            });
            const features = await featuresResponse.json();
            
            return {
                track: data.item,
                isPlaying: data.is_playing,
                features: features
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching track:', error);
        return null;
    }
}

function getWebviewContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Spotify Visualizer</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; overflow: hidden; }
            #container { display: flex; flex-direction: column; height: 100vh; padding: 20px; }
            #canvas-container { flex: 1; position: relative; margin-bottom: 20px; border-radius: 8px; overflow: hidden; background: #1a1a1a; }
            canvas { width: 100%; height: 100%; }
            #info { background: #1a1a1a; border-radius: 8px; padding: 20px; }
            #track-info { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
            #album-art { width: 80px; height: 80px; border-radius: 4px; background: #333; }
            #track-details h2 { font-size: 18px; margin-bottom: 5px; }
            #track-details p { color: #888; font-size: 14px; }
            #features { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
            .feature { background: #2a2a2a; padding: 10px; border-radius: 4px; }
            .feature-label { font-size: 12px; color: #888; margin-bottom: 5px; }
            .feature-value { font-size: 20px; font-weight: bold; color: #1db954; }
            #no-track { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #666; font-size: 18px; }
        </style>
    </head>
    <body>
        <div id="container">
            <div id="canvas-container">
                <canvas id="visualizer"></canvas>
                <div id="no-track" style="display: none;">No track playing</div>
            </div>
            <div id="info" style="display: none;">
                <div id="track-info">
                    <img id="album-art" src="" alt="">
                    <div id="track-details"><h2 id="track-name"></h2><p id="track-artist"></p></div>
                </div>
                <div id="features"></div>
            </div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            const canvas = document.getElementById('visualizer');
            const ctx = canvas.getContext('2d');
            let currentTrack = null, audioFeatures = null, isPlaying = false, animationId = null, time = 0;

            function resizeCanvas() {
                const container = canvas.parentElement;
                canvas.width = container.clientWidth;
                canvas.height = container.clientHeight;
            }
            window.addEventListener('resize', resizeCanvas);
            resizeCanvas();

            function animate() {
                if (!audioFeatures || !isPlaying) {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    return;
                }
                time += 0.05;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                const bars = 64, barWidth = canvas.width / bars;
                const energy = audioFeatures.energy || 0.5, valence = audioFeatures.valence || 0.5;
                const tempo = (audioFeatures.tempo || 120) / 120;
                for (let i = 0; i < bars; i++) {
                    const x = i * barWidth;
                    const wave1 = Math.sin(i * 0.2 + time * tempo) * energy;
                    const wave2 = Math.cos(i * 0.15 + time * tempo * 1.5) * valence;
                    const height = ((wave1 + wave2) * 0.5 + 1) * (canvas.height * 0.4);
                    const hue = (i / bars * 360 + time * 50) % 360;
                    const saturation = 70 + energy * 30, lightness = 50 + valence * 20;
                    ctx.fillStyle = \`hsl(\${hue}, \${saturation}%, \${lightness}%)\`;
                    ctx.fillRect(x, canvas.height / 2 - height / 2, barWidth - 2, height);
                }
                animationId = requestAnimationFrame(animate);
            }

            window.addEventListener('message', event => {
                if (event.data.command === 'updateTrack') updateTrackInfo(event.data.data);
            });

            function updateTrackInfo(data) {
                if (!data || !data.track) {
                    document.getElementById('no-track').style.display = 'block';
                    document.getElementById('info').style.display = 'none';
                    currentTrack = null; audioFeatures = null; isPlaying = false;
                    return;
                }
                document.getElementById('no-track').style.display = 'none';
                document.getElementById('info').style.display = 'block';
                currentTrack = data.track; audioFeatures = data.features; isPlaying = data.isPlaying;
                document.getElementById('album-art').src = currentTrack.album.images[0]?.url || '';
                document.getElementById('track-name').textContent = currentTrack.name;
                document.getElementById('track-artist').textContent = currentTrack.artists.map(a => a.name).join(', ');
                document.getElementById('features').innerHTML = \`
                    <div class="feature"><div class="feature-label">Energy</div><div class="feature-value">\${(audioFeatures.energy * 100).toFixed(0)}%</div></div>
                    <div class="feature"><div class="feature-label">Valence</div><div class="feature-value">\${(audioFeatures.valence * 100).toFixed(0)}%</div></div>
                    <div class="feature"><div class="feature-label">Tempo</div><div class="feature-value">\${audioFeatures.tempo.toFixed(0)} BPM</div></div>
                    <div class="feature"><div class="feature-label">Danceability</div><div class="feature-value">\${(audioFeatures.danceability * 100).toFixed(0)}%</div></div>
                \`;
                if (!animationId && isPlaying) animate();
            }
            vscode.postMessage({ command: 'getCurrentTrack' });
            animate();
        </script>
    </body>
    </html>`;
}

function deactivate() {
    if (updateInterval) clearInterval(updateInterval);
}

module.exports = { activate, deactivate };
