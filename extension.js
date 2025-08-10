const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

let challengesProvider;
let currentPanel;
let statusBarItem;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('DevElevate extension is now active!');

    // Create the tree data provider for challenges
    challengesProvider = new ChallengesProvider(context);
    
    // Register the tree view
    vscode.window.createTreeView('develevate.challengesView', {
        treeDataProvider: challengesProvider
    });

    // Show welcome message with quick start option
    setTimeout(() => {
        vscode.window.showInformationMessage(
            '🚀 DevElevate is ready! Open a .js or .py file to start coding challenges!',
            'Open Challenges',
            'Show Sidebar'
        ).then(selection => {
            if (selection === 'Open Challenges') {
                vscode.commands.executeCommand('develevate.openChallenges');
            } else if (selection === 'Show Sidebar') {
                vscode.commands.executeCommand('develevate.showSidebar');
            }
        });
    }, 1000);

    // Register commands
    const openChallengesCommand = vscode.commands.registerCommand('develevate.openChallenges', () => {
        createChallengePanel(context);
    });

    const showSidebarCommand = vscode.commands.registerCommand('develevate.showSidebar', () => {
        vscode.commands.executeCommand('workbench.view.explorer');
        vscode.window.showInformationMessage('DevElevate sidebar should now be visible in the Explorer panel below the file tree!');
    });

    const checkCurrentSolutionCommand = vscode.commands.registerCommand('develevate.checkCurrentSolution', () => {
        const currentChallenge = context.workspaceState.get('develevate.currentChallenge');
        if (currentChallenge) {
            checkSolution(currentChallenge.id, context);
        } else {
            vscode.window.showErrorMessage('No active challenge found. Please start a challenge first.');
        }
    });

    const startChallengeCommand = vscode.commands.registerCommand('develevate.startChallenge', (challenge) => {
        startChallenge(challenge, context);
    });

    const showHintCommand = vscode.commands.registerCommand('develevate.showHint', (challengeId) => {
        showHint(challengeId, context);
    });

    const checkSolutionCommand = vscode.commands.registerCommand('develevate.checkSolution', (challengeId) => {
        checkSolution(challengeId, context);
    });

    context.subscriptions.push(
        openChallengesCommand,
        showSidebarCommand,
        checkCurrentSolutionCommand,
        startChallengeCommand,
        showHintCommand,
        checkSolutionCommand
    );

    // Listen for active editor changes to update challenges
    vscode.window.onDidChangeActiveTextEditor(() => {
        challengesProvider.refresh();
    });
}

class ChallengesProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        return element;
    }

    async getChildren() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return [new ChallengeItem('No file open', 'Open a .js or .py file to see challenges', vscode.TreeItemCollapsibleState.None)];
        }

        const language = this.getLanguageFromFile(activeEditor.document.fileName);
        if (!language) {
            return [new ChallengeItem('Unsupported file type', 'DevElevate supports JavaScript (.js) and Python (.py) files', vscode.TreeItemCollapsibleState.None)];
        }

        const challenges = await this.getChallenges(language);
        const progress = this.getProgress();
        
        const items = [];
        
        // Add progress section
        const completedCount = progress[language] ? progress[language].length : 0;
        const totalCount = challenges.length;
        items.push(new ChallengeItem(
            `Progress: ${completedCount}/${totalCount}`,
            `${language.charAt(0).toUpperCase() + language.slice(1)} challenges completed`,
            vscode.TreeItemCollapsibleState.None
        ));

        // Add challenges
        challenges.forEach(challenge => {
            const isCompleted = progress[language] && progress[language].includes(challenge.id);
            const item = new ChallengeItem(
                `${isCompleted ? '✅ ' : ''}${challenge.title}`,
                challenge.description,
                vscode.TreeItemCollapsibleState.None
            );
            item.command = {
                command: 'develevate.startChallenge',
                title: 'Start Challenge',
                arguments: [challenge]
            };
            item.challenge = challenge;
            items.push(item);
        });

        return items;
    }

    getLanguageFromFile(fileName) {
        const ext = path.extname(fileName).toLowerCase();
        if (ext === '.js') return 'javascript';
        if (ext === '.py') return 'python';
        return null;
    }

    async getChallenges(language) {
        try {
            const challengesPath = path.join(__dirname, 'challenges.json');
            const challengesData = JSON.parse(fs.readFileSync(challengesPath, 'utf8'));
            return challengesData[language] || [];
        } catch (error) {
            console.error('Error loading challenges:', error);
            return [];
        }
    }

    getProgress() {
        return this.context.workspaceState.get('develevate.progress', {});
    }

    saveProgress(language, challengeId) {
        const progress = this.getProgress();
        console.log('DevElevate: Saving progress for', language, challengeId);
        console.log('DevElevate: Current progress:', progress);
        
        if (!progress[language]) {
            progress[language] = [];
        }
        if (!progress[language].includes(challengeId)) {
            progress[language].push(challengeId);
        }
        
        this.context.workspaceState.update('develevate.progress', progress);
        console.log('DevElevate: Updated progress:', progress);
        this.refresh();
    }
}

class ChallengeItem extends vscode.TreeItem {
    constructor(label, tooltip, collapsibleState) {
        super(label, collapsibleState);
        this.tooltip = tooltip;
        this.contextValue = 'challenge';
    }
}

function createChallengePanel(context) {
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside);
        return;
    }

    currentPanel = vscode.window.createWebviewPanel(
        'develevateChallenge',
        'DevElevate Challenges',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    currentPanel.onDidDispose(() => {
        currentPanel = undefined;
    });

    updateWebviewContent(currentPanel, context);

    // Handle messages from webview
    currentPanel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'startChallenge':
                if (message.challengeId && message.language) {
                    // Find the challenge by ID and language
                    const challengesPath = path.join(__dirname, 'challenges.json');
                    const challengesData = JSON.parse(fs.readFileSync(challengesPath, 'utf8'));
                    const challenge = challengesData[message.language]?.find(c => c.id === message.challengeId);
                    
                    if (challenge) {
                        await startChallenge(challenge, context);
                    }
                } else if (message.challenge) {
                    // Legacy support for old format
                    await startChallenge(message.challenge, context);
                }
                break;
            case 'showHint':
                await showHint(message.challengeId, context);
                break;
            case 'checkSolution':
                await checkSolution(message.challengeId, context);
                break;
            case 'refreshWebview':
                updateWebviewContent(currentPanel, context);
                break;
        }
    });
}

async function updateWebviewContent(panel, context) {
    try {
        // Load all challenges from both languages
        const challengesPath = path.join(__dirname, 'challenges.json');
        const challengesData = JSON.parse(fs.readFileSync(challengesPath, 'utf8'));
        
        const jsProgress = context.workspaceState.get('develevate.progress', {})['javascript'] || [];
        const pyProgress = context.workspaceState.get('develevate.progress', {})['python'] || [];

        panel.webview.html = getEnhancedWebviewContent(challengesData, jsProgress, pyProgress);
    } catch (error) {
        console.error('Error loading challenges:', error);
        panel.webview.html = getErrorWebviewContent();
    }
}

function getEnhancedWebviewContent(challengesData, jsProgress, pyProgress) {
    const jsCompletedCount = jsProgress.length;
    const pyCompletedCount = pyProgress.length;
    const jsTotalCount = challengesData.javascript.length;
    const pyTotalCount = challengesData.python.length;
    const totalCompleted = jsCompletedCount + pyCompletedCount;
    const totalChallenges = jsTotalCount + pyTotalCount;
    const overallProgress = totalChallenges > 0 ? Math.round((totalCompleted / totalChallenges) * 100) : 0;

    // Generate JavaScript challenge cards
    const jsCards = challengesData.javascript.map(challenge => {
        const isCompleted = jsProgress.includes(challenge.id);
        const difficultyColor = challenge.difficulty === 'beginner' ? '#4CAF50' : 
                               challenge.difficulty === 'intermediate' ? '#FF9800' : '#F44336';
        
        return `
            <div class="challenge-card ${isCompleted ? 'completed' : ''}" data-challenge='${JSON.stringify(challenge)}' data-language="javascript">
                <div class="language-badge js-badge">JavaScript</div>
                <div class="challenge-header">
                    <h3>${isCompleted ? '✅ ' : '🚀 '}${challenge.title}</h3>
                    <span class="difficulty" style="background-color: ${difficultyColor}">${challenge.difficulty}</span>
                </div>
                <p class="description">${challenge.description}</p>
                <div class="challenge-actions">
                    <button class="btn btn-primary" onclick="startChallenge('${challenge.id}', 'javascript')">
                        ${isCompleted ? '🔄 Redo Challenge' : '▶️ Start Challenge'}
                    </button>
                    <button class="btn btn-secondary" onclick="showHint('${challenge.id}')">💡 Show Hint</button>
                    ${isCompleted ? '<div class="completed-badge">🏆 Completed!</div>' : ''}
                </div>
            </div>
        `;
    }).join('');

    // Generate Python challenge cards
    const pyCards = challengesData.python.map(challenge => {
        const isCompleted = pyProgress.includes(challenge.id);
        const difficultyColor = challenge.difficulty === 'beginner' ? '#4CAF50' : 
                               challenge.difficulty === 'intermediate' ? '#FF9800' : '#F44336';
        
        return `
            <div class="challenge-card ${isCompleted ? 'completed' : ''}" data-challenge='${JSON.stringify(challenge)}' data-language="python">
                <div class="language-badge py-badge">Python</div>
                <div class="challenge-header">
                    <h3>${isCompleted ? '✅ ' : '🐍 '}${challenge.title}</h3>
                    <span class="difficulty" style="background-color: ${difficultyColor}">${challenge.difficulty}</span>
                </div>
                <p class="description">${challenge.description}</p>
                <div class="challenge-actions">
                    <button class="btn btn-primary" onclick="startChallenge('${challenge.id}', 'python')">
                        ${isCompleted ? '🔄 Redo Challenge' : '▶️ Start Challenge'}
                    </button>
                    <button class="btn btn-secondary" onclick="showHint('${challenge.id}')">💡 Show Hint</button>
                    ${isCompleted ? '<div class="completed-badge">🏆 Completed!</div>' : ''}
                </div>
            </div>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>DevElevate Challenges</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body { 
                    font-family: var(--vscode-font-family);
                    background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(139, 92, 246, 0.25), transparent 70%), #000000;
                    color: var(--vscode-editor-foreground);
                    padding: 20px;
                    line-height: 1.6;
                    min-height: 100vh;
                    position: relative;
                }
                .container { 
                    max-width: 1200px; 
                    margin: 0 auto; 
                }
                .header {
                    text-align: center;
                    margin-bottom: 40px;
                    padding: 30px;
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(0, 0, 0, 0.3));
                    border-radius: 16px;
                    border: 1px solid rgba(139, 92, 246, 0.3);
                    backdrop-filter: blur(10px);
                }
                .header h1 {
                    font-size: 2.5em;
                    margin-bottom: 10px;
                    background: linear-gradient(45deg, #4CAF50, #2196F3);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }
                .header p {
                    font-size: 1.2em;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 20px;
                }
                .overall-progress {
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(0, 0, 0, 0.3));
                    padding: 20px;
                    border-radius: 12px;
                    margin-bottom: 30px;
                    border: 1px solid rgba(139, 92, 246, 0.3);
                    backdrop-filter: blur(10px);
                }
                .progress-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                }
                .progress-stats {
                    display: flex;
                    gap: 30px;
                    justify-content: center;
                    margin-bottom: 15px;
                }
                .progress-stat {
                    text-align: center;
                }
                .progress-stat-number {
                    font-size: 1.8em;
                    font-weight: bold;
                    color: var(--vscode-textLink-foreground);
                }
                .progress-stat-label {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    text-transform: uppercase;
                }
                .overall-progress-bar {
                    background: rgba(139, 92, 246, 0.2);
                    height: 12px;
                    border-radius: 6px;
                    overflow: hidden;
                    position: relative;
                    border: 1px solid rgba(139, 92, 246, 0.3);
                }
                .overall-progress-fill {
                    background: linear-gradient(90deg, rgba(139, 92, 246, 0.8), rgba(99, 102, 241, 0.8));
                    height: 100%;
                    width: ${overallProgress}%;
                    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
                }
                .language-section {
                    margin-bottom: 40px;
                }
                .language-header {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    margin-bottom: 20px;
                    padding: 15px;
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(0, 0, 0, 0.3));
                    border-radius: 8px;
                    border-left: 4px solid;
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(139, 92, 246, 0.2);
                }
                .js-header { border-left-color: #f7df1e; }
                .py-header { border-left-color: #3776ab; }
                .language-title {
                    font-size: 1.5em;
                    font-weight: bold;
                }
                .language-progress {
                    margin-left: auto;
                    text-align: right;
                }
                .challenges-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .challenge-card {
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(0, 0, 0, 0.4));
                    border: 1px solid rgba(139, 92, 246, 0.3);
                    border-radius: 12px;
                    padding: 20px;
                    transition: all 0.3s ease;
                    position: relative;
                    overflow: hidden;
                    backdrop-filter: blur(10px);
                }
                .challenge-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 8px 25px rgba(139, 92, 246, 0.25);
                    border-color: rgba(139, 92, 246, 0.6);
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(0, 0, 0, 0.3));
                }
                .challenge-card.completed {
                    border-color: #4CAF50;
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(76, 175, 80, 0.15));
                    box-shadow: 0 4px 15px rgba(76, 175, 80, 0.2);
                }
                .language-badge {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-size: 0.7em;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                .js-badge {
                    background: #f7df1e;
                    color: #000;
                }
                .py-badge {
                    background: #3776ab;
                    color: #fff;
                }
                .challenge-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 15px;
                    margin-top: 25px;
                }
                .challenge-header h3 {
                    margin: 0;
                    color: var(--vscode-editor-foreground);
                    font-size: 1.2em;
                    flex: 1;
                    margin-right: 10px;
                }
                .difficulty {
                    padding: 4px 12px;
                    border-radius: 16px;
                    font-size: 0.7em;
                    font-weight: bold;
                    color: white;
                    text-transform: uppercase;
                    white-space: nowrap;
                }
                .description {
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 20px;
                    font-size: 0.95em;
                }
                .challenge-actions {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                    align-items: center;
                }
                .btn {
                    padding: 10px 16px;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-family: inherit;
                    font-size: 0.9em;
                    font-weight: 500;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .btn-primary {
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.8), rgba(99, 102, 241, 0.8));
                    color: white;
                    border: 1px solid rgba(139, 92, 246, 0.4);
                }
                .btn-primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.9), rgba(99, 102, 241, 0.9));
                }
                .btn-secondary {
                    background: rgba(139, 92, 246, 0.1);
                    color: rgba(139, 92, 246, 0.9);
                    border: 1px solid rgba(139, 92, 246, 0.3);
                }
                .btn-secondary:hover {
                    background: rgba(139, 92, 246, 0.2);
                    border-color: rgba(139, 92, 246, 0.5);
                }
                .completed-badge {
                    background: linear-gradient(135deg, #4CAF50, #45a049);
                    color: white;
                    padding: 6px 12px;
                    border-radius: 16px;
                    font-size: 0.8em;
                    font-weight: bold;
                    margin-left: auto;
                }
                @keyframes celebrate {
                    0%, 100% { transform: scale(1) rotate(0deg); }
                    25% { transform: scale(1.05) rotate(1deg); }
                    75% { transform: scale(1.05) rotate(-1deg); }
                }
                .celebrating {
                    animation: celebrate 0.6s ease-in-out;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>⚡ DevElevate Challenges</h1>
                    <p>Master JavaScript and Python with interactive coding challenges!</p>
                </div>

                <div class="overall-progress">
                    <div class="progress-header">
                        <h2>📊 Overall Progress</h2>
                        <span style="font-size: 1.2em; font-weight: bold;">${overallProgress}%</span>
                    </div>
                    <div class="progress-stats">
                        <div class="progress-stat">
                            <div class="progress-stat-number">${totalCompleted}</div>
                            <div class="progress-stat-label">Completed</div>
                        </div>
                        <div class="progress-stat">
                            <div class="progress-stat-number">${totalChallenges}</div>
                            <div class="progress-stat-label">Total</div>
                        </div>
                        <div class="progress-stat">
                            <div class="progress-stat-number">${jsCompletedCount + pyCompletedCount}</div>
                            <div class="progress-stat-label">Achievements</div>
                        </div>
                    </div>
                    <div class="overall-progress-bar">
                        <div class="overall-progress-fill"></div>
                    </div>
                    ${overallProgress === 100 ? '<div style="text-align: center; margin-top: 15px; font-size: 1.2em; color: #4CAF50; font-weight: bold;">🎉 Congratulations! All challenges completed! 🎉</div>' : ''}
                </div>

                <div class="language-section">
                    <div class="language-header js-header">
                        <span style="font-size: 1.5em;">🟨</span>
                        <div class="language-title">JavaScript Challenges</div>
                        <div class="language-progress">
                            <div style="font-size: 1.1em; font-weight: bold;">${jsCompletedCount}/${jsTotalCount}</div>
                            <div style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">${Math.round((jsCompletedCount/jsTotalCount)*100)}% Complete</div>
                        </div>
                    </div>
                    <div class="challenges-grid">
                        ${jsCards}
                    </div>
                </div>

                <div class="language-section">
                    <div class="language-header py-header">
                        <span style="font-size: 1.5em;">🐍</span>
                        <div class="language-title">Python Challenges</div>
                        <div class="language-progress">
                            <div style="font-size: 1.1em; font-weight: bold;">${pyCompletedCount}/${pyTotalCount}</div>
                            <div style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">${Math.round((pyCompletedCount/pyTotalCount)*100)}% Complete</div>
                        </div>
                    </div>
                    <div class="challenges-grid">
                        ${pyCards}
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                function startChallenge(challengeId, language) {
                    vscode.postMessage({
                        command: 'startChallenge',
                        challengeId: challengeId,
                        language: language
                    });
                }
                
                function showHint(challengeId) {
                    vscode.postMessage({
                        command: 'showHint',
                        challengeId: challengeId
                    });
                }

                // Listen for progress updates
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    if (message.command === 'celebrate') {
                        // Add celebration animation to the completed challenge
                        const challengeCards = document.querySelectorAll('.challenge-card');
                        challengeCards.forEach(card => {
                            if (card.querySelector('h3').textContent.includes(message.challengeTitle)) {
                                card.classList.add('celebrating');
                                setTimeout(() => card.classList.remove('celebrating'), 600);
                            }
                        });
                        
                        // Refresh the page to show updated progress
                        setTimeout(() => {
                            vscode.postMessage({ command: 'refreshWebview' });
                        }, 1000);
                    }
                });
            </script>
        </body>
        </html>
    `;
}

function getErrorWebviewContent() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>DevElevate - Error</title>
            <style>
                body { 
                    font-family: var(--vscode-font-family);
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    padding: 40px;
                    text-align: center;
                }
                .error-container {
                    max-width: 500px;
                    margin: 0 auto;
                    padding: 40px;
                    border: 2px dashed var(--vscode-panel-border);
                    border-radius: 12px;
                }
            </style>
        </head>
        <body>
            <div class="error-container">
                <h1>⚠️ Error Loading Challenges</h1>
                <p>Unable to load challenge data. Please make sure the challenges.json file exists.</p>
            </div>
        </body>
        </html>
    `;
}

async function startChallenge(challenge, context) {
    try {
        // Determine file extension and create proper filename
        const isJavaScript = challenge.id.startsWith('js-');
        const fileExtension = isJavaScript ? '.js' : '.py';
        const fileName = `DevElevate-${challenge.title.replace(/[^a-zA-Z0-9]/g, '-')}${fileExtension}`;
        
        // Create file path in workspace root
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        let filePath;
        
        if (workspaceFolder) {
            // Create in workspace folder with proper name
            filePath = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(challenge.starter, 'utf8'));
            
            // Open the created file
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
        } else {
            // Fallback to untitled document if no workspace
            const doc = await vscode.workspace.openTextDocument({
                content: challenge.starter,
                language: isJavaScript ? 'javascript' : 'python'
            });
            await vscode.window.showTextDocument(doc);
        }
        
        // Show challenge description with enhanced message
        const message = `🎯 Challenge: ${challenge.title}\n\n📝 ${challenge.prompt}\n\n💡 Tip: Use "Show Hint" if you get stuck!\n\n🚀 When ready, press Ctrl+Shift+P and run "DevElevate: Check Current Solution"`;
        vscode.window.showInformationMessage(message, 
            { modal: false },
            'Check Solution',
            'Show Hint'
        ).then(selection => {
            if (selection === 'Check Solution') {
                vscode.commands.executeCommand('develevate.checkCurrentSolution');
            } else if (selection === 'Show Hint') {
                vscode.commands.executeCommand('develevate.showHint', challenge.id);
            }
        });
        
        // Store current challenge for solution checking
        context.workspaceState.update('develevate.currentChallenge', challenge);
        
        // Create/update status bar item
        if (!statusBarItem) {
            statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            context.subscriptions.push(statusBarItem);
        }
        statusBarItem.text = `$(check) Check Solution: ${challenge.title}`;
        statusBarItem.command = 'develevate.checkCurrentSolution';
        statusBarItem.tooltip = 'Click to check your solution for the current DevElevate challenge';
        statusBarItem.show();
        
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to start challenge: ${error.message}`);
    }
}

async function showHint(challengeId, context) {
    try {
        const challengesPath = path.join(__dirname, 'challenges.json');
        const challengesData = JSON.parse(fs.readFileSync(challengesPath, 'utf8'));
        
        let challenge = null;
        for (const lang in challengesData) {
            challenge = challengesData[lang].find(c => c.id === challengeId);
            if (challenge) break;
        }
        
        if (!challenge) {
            vscode.window.showErrorMessage('Challenge not found');
            return;
        }
        
        const currentHintIndex = context.workspaceState.get(`hint-${challengeId}`, 0);
        
        if (currentHintIndex >= challenge.hints.length) {
            vscode.window.showInformationMessage('No more hints available for this challenge!');
            return;
        }
        
        const hint = challenge.hints[currentHintIndex];
        const hintNumber = currentHintIndex + 1;
        const totalHints = challenge.hints.length;
        
        vscode.window.showInformationMessage(
            `💡 Hint ${hintNumber}/${totalHints}: ${hint}`,
            { modal: false }
        );
        
        // Update hint index
        context.workspaceState.update(`hint-${challengeId}`, currentHintIndex + 1);
        
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to show hint: ${error.message}`);
    }
}

async function checkSolution(challengeId, context) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }
    
    const code = activeEditor.document.getText();
    const currentChallenge = context.workspaceState.get('develevate.currentChallenge');
    
    if (!currentChallenge || currentChallenge.id !== challengeId) {
        vscode.window.showErrorMessage('No active challenge found. Please start a challenge first.');
        return;
    }
    
    try {
        vscode.window.showInformationMessage('🔄 Running your solution...');
        
        const isJavaScript = currentChallenge.id.startsWith('js-');
        const command = isJavaScript ? 'node' : 'python';
        const tempFileName = isJavaScript ? 'temp.js' : 'temp.py';
        const tempFilePath = path.join(__dirname, tempFileName);
        
        // Write code to temporary file
        fs.writeFileSync(tempFilePath, code);
        
        exec(`${command} "${tempFilePath}"`, { timeout: 5000 }, (error, stdout, stderr) => {
            // Clean up temp file
            try {
                fs.unlinkSync(tempFilePath);
            } catch (cleanupError) {
                // Ignore cleanup errors
                console.log('Cleanup error:', cleanupError.message);
            }
            
            if (error) {
                vscode.window.showErrorMessage(`❌ Error running code: ${error.message}`);
                return;
            }
            
            if (stderr) {
                vscode.window.showWarningMessage(`⚠️ Warning: ${stderr}`);
            }
            
            const output = stdout.trim();
            const expected = currentChallenge.expectedOutput;
            
            if (output === expected) {
                // Show success with progress info
                const language = isJavaScript ? 'javascript' : 'python';
                const currentProgress = challengesProvider.getProgress();
                const completedBefore = currentProgress[language] ? currentProgress[language].length : 0;
                
                vscode.window.showInformationMessage(`🎉 Correct! Well done!\n\n🏆 Progress Update: ${completedBefore}/5 → ${completedBefore + 1}/5`);
                
                // Mark challenge as completed with visual feedback
                challengesProvider.saveProgress(language, currentChallenge.id);
                
                // Reset hint progress
                context.workspaceState.update(`hint-${currentChallenge.id}`, 0);
                
                // Update webview with celebration animation
                if (currentPanel) {
                    updateWebviewContent(currentPanel, context);
                    // Send celebration message to webview
                    currentPanel.webview.postMessage({
                        command: 'celebrate',
                        progress: completedBefore + 1,
                        total: 5
                    });
                }
                
            } else {
                vscode.window.showErrorMessage(`❌ Not quite right. Expected: "${expected}", but got: "${output}"\n\n💡 Tip: Try using "Show Hint" for guidance!`);
            }
        });
        
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to check solution: ${error.message}`);
    }
}

function deactivate() {
    if (currentPanel) {
        currentPanel.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};
