const vscode = require('vscode');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const execAsync = promisify(exec);

const lastLineNumbers = new Map();
const gitDirectoryCache = new Map();
const getEditorId = editor => editor.document.uri.toString();

async function isGitDirectory(projectRoot) {
  if (gitDirectoryCache.has(projectRoot)) return gitDirectoryCache.get(projectRoot);

  try {
    await execAsync('git rev-parse --git-dir', { cwd: projectRoot });
    gitDirectoryCache.set(projectRoot, true);
    return true;
  } catch (error) {
    gitDirectoryCache.set(projectRoot, false);
  }
  return false;
}

function getRelativeTime(date) {
  const now = new Date();
  const diffSeconds = Math.floor((now - date) / 1000);

  if (diffSeconds < 60) {
    return `${diffSeconds} seconds ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
  }

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} ${diffYears === 1 ? 'year' : 'years'} ago`;
}

/**
 * Update decorations for the specified editor
 * @param {vscode.TextEditor} editor
 * @param {vscode.TextEditorDecorationType} decorationType
 */
async function updateDecorations(editor, decorationType) {
  if (!editor) return;

  try {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) return;

    const projectRoot = workspaceFolder.uri.fsPath;

    const isGitRepo = await isGitDirectory(projectRoot);
    if (!isGitRepo) return;


    const selection = editor.selection;
    const lineNumber = selection.active.line;

    const filePath = editor.document.uri.fsPath;
    const relativePath = path.relative(projectRoot, filePath);

    const { stdout } = await execAsync(
      `git blame -L ${lineNumber + 1},${lineNumber + 1} --porcelain "${relativePath}"`,
      { cwd: projectRoot }
    );

    // parse the output
    let author = stdout.match(/author (.+)/)?.[1] || 'Unknown';
    const notCommit = author === 'Not Committed Yet'
    author = notCommit ? 'You' : author
    const time = stdout.match(/author-time ([0-9]+)/)?.[1];

    if (!time) { editor.setDecorations(decorationType, []); return; }

    const date = new Date(parseInt(time) * 1000);
    const timeAgo = getRelativeTime(date);
    const timeAgoText = notCommit ? '' : `, ${timeAgo}`
    const fullDateTime = notCommit ? '' : date.toLocaleString()


    const summary = notCommit ? 'Uncommitted changes' : stdout.match(/summary (.+)/)?.[1] || '';
    const displayText = `${author}${timeAgoText} • ${summary}`

    // create the decoration
    const length = editor.document.lineAt(lineNumber).text.length

    const decoration = {
      range: new vscode.Range(lineNumber, length, lineNumber, length),
      renderOptions: {
        after: {
          contentText: displayText,
          hover: !notCommit
        }
      },
      hoverMessage: notCommit ? '' : `${fullDateTime}`
    }

    editor.setDecorations(decorationType, [decoration]);
    lastLineNumbers.set(getEditorId(editor), lineNumber);
  } catch (error) {
    editor.setDecorations(decorationType, []);
  }
}


function getDecorationType() {
  return vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2.5em', color: 'rgba(153, 153, 153, 0.4)' },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const decorationType = getDecorationType();
  let timeout = null;

  // listen to the selection change
  vscode.window.onDidChangeTextEditorSelection(event => {
    editor = event.textEditor;
    const lastLineNumber = lastLineNumbers.get(getEditorId(editor));
    const lineNumber = editor.selection.active.line;
    if (lastLineNumber === lineNumber) {
        if(editor.document.isDirty)
            editor.setDecorations(decorationType, []);

        return;
    }

    editor.setDecorations(decorationType, []);
    timeout && clearTimeout(timeout);
    timeout = setTimeout(() => {
      updateDecorations(editor, decorationType)
    }, 100);
  }, null, context.subscriptions);


  // listen to the editor change
  vscode.window.onDidChangeActiveTextEditor(editor => {
    updateDecorations(editor, decorationType);
  }, null, context.subscriptions);

  // initialize
  let editor = vscode.window.activeTextEditor;
  updateDecorations(editor, decorationType);
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
};
