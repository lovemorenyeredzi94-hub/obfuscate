const JavaScriptObfuscator = require('javascript-obfuscator');
const axios = require('axios');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { 
            code, 
            preset, 
            cli, 
            github_token, 
            github_repo, 
            github_path, 
            github_message, 
            github_branch 
        } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'No code provided' });
        }

        // Parse CLI options if provided
        let options = {};
        if (cli) {
            try {
                const cliParams = cli.split('--').filter(p => p.trim());
                cliParams.forEach(param => {
                    const parts = param.trim().split(' ');
                    if (parts.length >= 2) {
                        const key = parts[0].trim();
                        const value = parts.slice(1).join(' ').trim();
                        if (value === 'true') options[key] = true;
                        else if (value === 'false') options[key] = false;
                        else if (!isNaN(value)) options[key] = Number(value);
                        else if (value.startsWith('[') && value.endsWith(']')) {
                            try { options[key] = JSON.parse(value); } 
                            catch(e) { options[key] = value; }
                        } else options[key] = value;
                    }
                });
            } catch (e) {
                console.error('CLI parsing error:', e);
            }
        }

        // Apply preset if no CLI options
        if (Object.keys(options).length === 0) {
            options = getPresetOptions(preset || 'standard');
        }

        // Obfuscate
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, options);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // Calculate stats
        const stats = {
            originalSize: code.length,
            obfuscatedSize: obfuscatedCode.length,
            sizeIncrease: ((obfuscatedCode.length - code.length) / code.length * 100).toFixed(1) + '%'
        };

        const response = {
            obfuscatedCode,
            stats,
            preset: preset || 'custom',
            meta: {
                security: getSecurityLevel(preset || 'custom')
            }
        };

        // Handle GitHub push if requested
        if (github_token && github_repo && github_path) {
            const pushResult = await pushToGithub(
                github_token,
                github_repo,
                github_path,
                obfuscatedCode,
                github_message || 'Update obfuscated file',
                github_branch || 'main'
            );
            response.github = pushResult;
        }

        res.json(response);
    } catch (error) {
        console.error('Obfuscation error:', error);
        res.status(500).json({ 
            error: error.message || 'Obfuscation failed' 
        });
    }
};

function getPresetOptions(preset) {
    const presets = {
        light: {
            compact: true,
            controlFlowFlattening: false,
            deadCodeInjection: false,
            debugProtection: false,
            disableConsoleOutput: false,
            identifierNamesGenerator: 'hexadecimal',
            renameGlobals: false,
            rotateStringArray: false,
            selfDefending: false,
            stringArray: true,
            stringArrayThreshold: 0.5,
            unicodeEscapeSequence: false
        },
        standard: {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            debugProtection: false,
            disableConsoleOutput: false,
            identifierNamesGenerator: 'hexadecimal',
            renameGlobals: false,
            rotateStringArray: true,
            selfDefending: true,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.75,
            unicodeEscapeSequence: false
        },
        maximum: {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 1,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 1,
            debugProtection: true,
            debugProtectionInterval: true,
            disableConsoleOutput: true,
            identifierNamesGenerator: 'hexadecimal',
            renameGlobals: true,
            rotateStringArray: true,
            selfDefending: true,
            stringArray: true,
            stringArrayEncoding: ['rc4'],
            stringArrayThreshold: 1,
            unicodeEscapeSequence: true
        }
    };
    return presets[preset] || presets.standard;
}

function getSecurityLevel(preset) {
    const levels = {
        light: 'Low',
        standard: 'Medium',
        maximum: 'High',
        custom: 'Custom'
    };
    return levels[preset] || 'Custom';
}

async function pushToGithub(token, repo, path, content, message, branch) {
    try {
        const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
        const contentBase64 = Buffer.from(content).toString('base64');

        // Check if file exists to get SHA
        let sha = null;
        try {
            const getRes = await axios.get(apiUrl, {
                headers: { Authorization: `token ${token}` }
            });
            sha = getRes.data.sha;
        } catch (e) {
            if (e.response?.status !== 404) throw e;
        }

        const payload = {
            message,
            content: contentBase64,
            branch
        };
        if (sha) payload.sha = sha;

        const response = await axios.put(apiUrl, payload, {
            headers: { 
                Authorization: `token ${token}`,
                'Content-Type': 'application/json'
            }
        });

        return { 
            pushed: true, 
            url: response.data.content.html_url 
        };
    } catch (error) {
        console.error('GitHub push error:', error);
        throw new Error(error.response?.data?.message || 'GitHub push failed');
    }
}