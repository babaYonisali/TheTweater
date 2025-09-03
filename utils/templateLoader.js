const fs = require('fs');
const path = require('path');

function loadTemplate(templateName, replacements = {}) {
  try {
    const templatePath = path.join(__dirname, '..', 'views', `${templateName}.html`);
    let html = fs.readFileSync(templatePath, 'utf8');
    
    // Replace placeholders with actual values
    Object.keys(replacements).forEach(key => {
      const placeholder = `{{${key}}}`;
      html = html.replace(new RegExp(placeholder, 'g'), replacements[key]);
    });
    
    return html;
  } catch (error) {
    console.error(`Error loading template ${templateName}:`, error);
    return `<h1>Error loading template</h1><p>${error.message}</p>`;
  }
}

module.exports = { loadTemplate };



