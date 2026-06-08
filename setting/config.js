const fs = require('fs')

global.owner = ["234"] //owner number
global.status = false
global.prefa = ['','!','.',',','🌻','✨']
global.owner = ['62']
global.xprefix = '.'
global.OWNER_NAME = "TK Cariño"
global.DEVELOPER = ["2347081827038"]
global.BOT_NAME = "TK Cariño 🌻✨ workshop ¤bot"
global.bankowner = "TK Cariño 🌻✨ workshop ¤bot"
global.creatorName = "TK Cariño 🌻✨ workshop ¤bot"
global.ownernumber = '2347081827038'
global.location = "Philippines"
global.prefa = ['','!','.','#','&']
//================DO NOT CHANGE OR YOU'LL GET AN ERROR=============
global.footer = "TK Cariño 🌻✨ workshop ¤bot"
global.link = "https://chat.whatsapp.com/Bnrx29Li2mZDS2LKxI9LYM"
global.autobio = true
global.botName = "TK Cariño 🌻✨ workshop ¤bot"
global.version = "1.0.1"
global.botname = "TK Cariño 🌻✨ workshop ¤bot"
global.author = "TK Cariño"
global.themeemoji = "🌻"
global.wagc = 'https://chat.whatsapp.com/Bnrx29Li2mZDS2LKxI9LYM'
global.richpp = ' '
global.packname = "Sticker By TK Cariño 🌻✨"
global.creator = "2347081827038@s.whatsapp.net"
global.ownername = 'TK Cariño'
global.onlyowner = `Only TK Cariño can use this Command 🌻✨`
global.database = `*To Exist In The Database Contact The Owner of this bot*`
global.mess = {
  wait: "*Configurating.......*",
  success: "*Successfully acknowledged ☑️*",
  on: "*Activated ✅*",
  prem: "*Feature For Premium Users only*",
  off: "*Deactivated 📛*",
  query: {
    text: "*Please, Provide A Text Query 📑*",
    link: "Please, provide a valid link 🔗*",
  },
  error: {
    fitur: "*Status 🌐: Feature Or Command error ❌*",
  },
  only: {
    group: "*Group only feature ❌*",
    private: "*Private chat feature only ❌*",
    owner: "*Owner feature only ❌*",
    admin: "*Bot owner feature only ❌*",
    badmin: "*Seek admin privilege's to use this command ❌*",
    premium: "*Available for premium users only ❌*",
  }
}

global.hituet = 0
global.autoviewstatus = false
global.autoread = false
global.autobio = true
global.anti92 = true
global.autoswview = true

let file = require.resolve(__filename)
require('fs').watchFile(file, () => {
  require('fs').unwatchFile(file)
  console.log('\x1b[0;32m'+__filename+' \x1b[1;32mupdated!\x1b[0m')
  delete require.cache[file]
  require(file)
})
