const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors')
const qrcode = require('qrcode-terminal');
const qrcode_url = require('qrcode');
const fs = require('fs');
const http = require('http');
const https = require('https');
//https.globalAgent.options.rejectUnauthorized = false
const request = require('request');
const glob = require("glob");
const { body, validationResult } = require('express-validator');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const port = process.env.PORT || 3000;
const bodyParser = require('body-parser')
const jsonParser = bodyParser.json()
const app = express();
const server = http.createServer(app);

const con = require('./wadb.ts');
const myArgs = process.argv.slice(2);
var wa_files_folder="";
let status = "NOT READY";
let qrcode_return = null;
let datauser = null;
const callback_server = "https://fekusa.xyz/sendwa/";
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));
app.use(fileUpload({
  debug: false
}));
app.use(cors())

async function saveContact(contact,ppUrl)
{
  let querySt="";
  let contactName="";
  let info = client.info;
  let datauser = info.me.user;

  if (typeof contact.verifiedName!=="undefined")
  contactName=contact.verifiedName;
  else if (typeof contact.name!=="undefined")
  contactName=contact.name;
  else if (typeof contact.pushname!=="undefined")
  contactName=contact.pushname;
  else if (typeof contact.shortName!=="undefined")
  contactName=contact.shortName;

  if (typeof ppUrl=="undefined")
  ppUrl="";

  // URL of the image
  const url = ppUrl;
  const nf = contact.id._serialized+'.jpeg';
  if(url !== ""){
    https.get(url,(res) => {
      // Image will be stored at this path
      //const path = '../messaging/images/whatsapp/profile/'+nf;
      const path = './assets/images/whatsapp/profile/'+nf;
      const filePath = fs.createWriteStream(path);
      res.pipe(filePath);
      filePath.on('finish',() => {
        filePath.close();
        console.log('Download Completed');
      })
    })

  }
  console.log("Task: Profile picture "+contact.id._serialized+" is: " + ppUrl);
  querySt="REPLACE INTO profiles VALUES ('"+contact.id._serialized+"','"+contactName+"','"+nf+"','"+datauser+"',NOW())";
  console.log("Query: "+querySt);

  con.query(querySt, function (error, results, fields)
  {
    if (error)
    {
      console.log('Task: ERROR menyimpan profile '+contact.id._serialized+" "+contactName+', picture path: '+ppUrl+error.code);
      console.log("Query: "+querySt);
    }
    else
    {
      console.log('Sukses simpan data profile picture '+contact.id._serialized);
    }
  });
}

async function getContacts(contacts)
{
  let ppUrl="";
  console.log(contacts.length);
  for (const contact of contacts)
  {
    console.log("Task: NEW CONTACT");
    console.log(contact);

    ppUrl = await contact.getProfilePicUrl()
    .then((value)=>saveContact(contact,value))
    .catch(error=>saveContact(contact,""));
    //console.log("Task: FAILED Getting Picture of "+contact.id._serialized+" -> " + error));
  }
}

async function getContact_by_message(message)
{
  console.log("Task: UPDATE CONTACT (msg from) "+message.from);
  await message.getContact()
  .then((contact)=>contact.getProfilePicUrl()
  .then((ppvalue)=>saveContact(contact,ppvalue))
  .catch(error=>saveContact(contact,"")))
  .catch(error=>console.log("TASK: ERROR Retrieving Contact Data "+message.from));
}

async function getContact_by_ID(jid)
{
  console.log("Task: UPDATE CONTACT (by ID) "+jid);

  await client.getContactById(jid)
  .then((contact)=>contact.getProfilePicUrl()
  .then((ppvalue)=>saveContact(contact,ppvalue))
  .catch(error=>saveContact(contact,"")))
  .catch(error=>console.log("TASK: ERROR Retrieving Contact Data "+jid));
}

async function downloadMessageMedia(attachmentData,fn,msgFrom,msgID)
{
  if (typeof attachmentData !== "undefined")
  {
    let fExt=attachmentData.mimetype.split("/")[1];
    let fExtRegex = new RegExp('ogg');

    if (fExtRegex.test(fExt)) fExt="ogg";

    fn=wa_files_folder+fn+"."+fExt;
    console.log("Task: "+msgFrom+" message "+ msgID +
    " in DB but no file. Downloading to "+fn);
    try
    {
      fs.writeFileSync(fn, attachmentData.data, 'base64');
      console.log("Task: file saved. "+msgID);
    }
    catch (error)
    {
      console.error("Task: Unable to write downloaded file to disk. "+msgID);
    }
  }
}

async function saveMessageToDB(querySt)
{
  console.log(querySt);

  con.query(querySt, function (error, results, fields)
  {
    if (error)
    {
      console.log("Task: "+error.code+". Query:\n"+error.sql);
      if (error.code=="ER_DUP_ENTRY")
      {
      }
      if (error.code=="ER_PARSE_ERROR")
      {
      }
    }
    else
    {
      console.log("Pesan tersimpan di database.");
    }
  });
}

async function saveMessage(chatMessage)
{
  let querySt1=querySt2=""
  let msgContent;
  let msgType;
  let msgFromMe;
  let fn="";
  let fileNames;
  let safeDelete;
  let participantJid="";
  let remoteJid="";
  let isForwardedFlag="";
  let broadcastFlag="";
  let ppUrl="";
  let links="";
  let remoteIDs = new Set();

  let str_msg = JSON.stringify(chatMessage);
  let msg = JSON.parse(str_msg);

  if (msg.isStatus == false)
  {
    if (msg.type == "location")
    msgContent=JSON.stringify(msg.location);
    else
    msgContent=msg.body;

    if (msg.fromMe)
    {
      msgFromMe='1';
      remoteJid=msg.to;
      remoteIDs.add(msg.to);
      fn=msg.to.split("@")[0]+"-"+msg.id.id;
    }
    else
    {
      msgFromMe='0';
      remoteJid=msg.from;
      remoteIDs.add(msg.from);
      fn=msg.from.split("@")[0]+"-"+msg.id.id;
    }

    fileNames = glob.sync(fn+".*", { cwd: wa_files_folder });

    if (msg.type == "chat") { msg.type = "0"; }
    else if (msg.type == "audio") { msg.type = "1"; }
    else if (msg.type == "voice") { msg.type = "2"; }
    else if (msg.type == "image") { msg.type = "3"; }
    else if (msg.type == "video") { msg.type = "4"; }
    else if (msg.type == "document") { msg.type = "5"; }
    else if (msg.type == "sticker") { msg.type = "6"; }
    else if (msg.type == "location")
    {
      let thumbnailData={
        data: msg.body,
        mimetype: "image/jpeg"
      };
      if (fileNames.length==0)
      await downloadMessageMedia(thumbnailData,fn,remoteJid,msg.id.id);
      msg.type = "7";
    }
    else if (msg.type == "contact_card") { msg.type = "8"; }
    else if (msg.type == "vcard") { msg.type = "8"; }
    else if (msg.type == "contact_card_multi") { msg.type = "9"; }
    else if (msg.type == "order") { msg.type = "10"; }
    else if (msg.type == "revoked") { msg.type = "11"; }
    else if (msg.type == "product") { msg.type = "12"; }
    else if (msg.type == "unknown") { msg.type = "13"; }
    else if (msg.type == "group_invite") { msg.type = "14"; }

    if (msg.from.includes("g.us"))
    {
      participantJid="|"+msg.author;
      remoteIDs.add(msg.author);
    }
    else
    participantJid="";

    if (msg.hasOwnProperty('isForwarded'))
    isForwardedFlag=msg.isForwarded;
    else
    isForwardedFlag=false;

    if (msg.hasOwnProperty('broadcast'))
    broadcastFlag=msg.broadcast;
    else
    broadcastFlag=false;

    if (msg.links.hasOwnProperty('link'))
    links=JSON.stringify(msg.links);
    else
    links="";

    let mentionIDs=JSON.stringify(msg.mentionedIds);

    querySt1="REPLACE INTO chat_messages VALUES ('"+remoteJid+participantJid+"','"+
    msg.id.id+"','"+msgFromMe+"',"+
    msg.timestamp+",'"+msg.type+"',"+
    con.escape(msgContent)+",'"+msg.ack+"',"+
    broadcastFlag+",'"+
    msg.deviceType+"',"+msg.forwardingScore;
    querySt2=isForwardedFlag+","+
    msg.isStarred+",'"+links+"','"+mentionIDs+"')";

    console.log("Task: DB Insert message "+msg.id.id);

    if (msg.hasQuotedMsg)
    {
      await chatMessage.getQuotedMessage()
      .then((quotedMsg)=>saveMessageToDB(querySt1+",'"+quotedMsg.from+":"+quotedMsg.id.id+"',"+querySt2))
      .catch(error=>console.error("Task: Get Quoted Message gagal "+msg.id.id+error));
    }
    else
    {
      await saveMessageToDB(querySt1+",'',"+querySt2);
    }

    if (msg.hasMedia)
    {
      console.log("Task: Media Message. "+msg.id.id);

      if (fileNames.length>0)
      safeDelete=1;
      else
      {
        safeDelete=0;
        let attachmentData = await chatMessage.downloadMedia()
        .then(mediadata=>downloadMessageMedia(mediadata,fn,msg.from,msg.id.id))
        .catch(error=>console.error("Task: Download Message Media gagal "+msg.id.id+error));
        //console.log(attachmentData);
      }
    }
    else
    safeDelete=1;
    /*
    if (safeDelete==1)
    {
    await deleteMessage(remoteJid, msg.id.id, msg.messageTimestamp);
  }
  */
  console.log("Task: Saving message "+ msg.id.id +" DONE");
}
}

async function saveChat(chat,latestOnly)
{
  let remoteJid="";
  let remoteIDs = new Set();
  let msgs;
  //console.log(chat);

  if (latestOnly)
  {
    console.log("Task: Download total unread messages = "+chat.unreadCount);
    msgs = await chat.fetchMessages({limit : chat.unreadCount});
  }
  else
  msgs = await chat.fetchMessages({limit : 99999});

  //console.log(msgs.length);
  //console.log(msgs);

  let msgIndex=0;
  let str_msgs = JSON.stringify(msgs);
  let msgs_array = JSON.parse(str_msgs);

  for (let msg of msgs_array)
  {
    console.log("Task: NEW MESSAGE #"+msgIndex);
    console.log(msg);
    //console.log("Task: ORIGINAL MESSAGE #"+msgIndex);
    //console.log(msgs[msgIndex]);
    await saveMessage(msgs[msgIndex]);

    if (msg.isStatus == false)
    {
      remoteIDs.add(msg.to);
      remoteIDs.add(msg.from);
      if (msg.from.includes("g.us"))
      remoteIDs.add(msg.author);
    }
    msgIndex++;
  }
  for (let rID of remoteIDs)
  await getContact_by_ID(rID);
  chat.sendSeen();
  return 1;
}

async function saveChats(chats)
{
  let msgType;
  let remoteJid="";
  let remoteIDs = new Set();

  console.log("Task: Jumlah Chat = "+chats.length);
  for (const mChat of chats)
  {
    let msgIndex=0;
    let msgs = await mChat.fetchMessages({limit : 50});
    //console.log(msgs.length);
    //console.log(msgs);

    let str_msgs = JSON.stringify(msgs);
    let msgs_array = JSON.parse(str_msgs);
    //console.log(msgs_array);
    console.log("Jumlah message dalam chat ini = "+msgs_array.length);

    for (let msg of msgs_array)
    {
      console.log("Task: NEW MESSAGE #"+msgIndex);
      console.log(msg);
      //console.log("Task: ORIGINAL MESSAGE #"+msgIndex);
      //console.log(msgs[msgIndex]);
      await saveMessage(msgs[msgIndex]);

      if (msg.isStatus == false)
      {
        remoteIDs.add(msg.to);
        remoteIDs.add(msg.from);
        if (msg.from.includes("g.us"))
        remoteIDs.add(msg.author);
      }
      msgIndex++;
    }
  }
  for (let rID of remoteIDs)
  {
    await getContact_by_ID(rID);
  }
  return 1;
}

// Path where the session data will be stored
//const SESSION_FILE_PATH = '../messaging/auth_info.json';
const SESSION_FILE_PATH = './whatsapp-session'+port+'.json';

// Load the session data if it has been previously saved
let sessionData;
if (fs.existsSync(SESSION_FILE_PATH)) {
  sessionData = require(SESSION_FILE_PATH);
}

config_querySt="SELECT value FROM config WHERE type='image_file_dir' and module='whatsapp'";
con.query(config_querySt, function (err, result, fields) {
  if (err) throw err;
  wa_files_folder=result[0].value;
});

const client = new Client({
  session: sessionData,
  // puppeteer: {
  //      executablePath: '/usr/bin/google-chrome',
  //      headless: false
  // }
  restartOnAuthFail: true,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      // '--single-process', // <- this one doesn't works in Windows
      '--disable-gpu'
    ],
  },
});

client.on('qr', (qr) => {
  console.log('QR RECEIVED', qr);
  qrcode.generate(qr, {small: true});
  qrcode_url.toDataURL(qr, (err, url) => {
    qrcode_return = url;
  });
});
client.on('change_state', state => {
  console.log('CHANGE STATE', state );
});
client.on('ready', async () => {
  status = "READY";
//   const chats = await client.getChats()
//     .then(response=>saveChats(response));
  console.log('Client is ready!');
});

// Save session values to the file upon successful auth
client.on('authenticated', (session) => {
  sessionData = session;
  fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), (err) => {
    if (err) {
      console.error(err);
    }
  });
});


client.on('disconnected', (reason) => {
  status = "NOT READY";
  console.log('Client was logged out', reason);
  fs.unlinkSync(SESSION_FILE_PATH, function(err) {
    if(err) return console.log(err);
    console.log('Session file deleted!');
  });
  con.end();
  client.destroy();
});
client.on('message', async msg => {
  console.log('MESSAGE RECEIVED', msg);
  await saveMessage(msg);
  let contact= msg.from;
  let contactnya = contact.replace('@c.us','');
  let thismsg = encodeURIComponent(msg.body);
  let url = callback_server+"webhookapi.php?nomor="+contactnya+"&msg="+thismsg+"&port="+port;
   https.get(url,(res) => {
     let body = "";
     res.on("data", (chunk) => {
       body += chunk;
     });
     res.on("end", () => {});
  
   }).on("error", (error) => {
     console.error(error.message);
   });
  console.log(url);
});

client.initialize();

app.get("/qr", (req, res) => {
  res.status(200).json({
    status: true,
    msg: "Mendapatkan QR Code",
    qr: qrcode_return
  });
});

app.get("/status", (req, res) => {
  res.status(200).json({
    status: true,
    msg: status,
    data: datauser
  });
});

app.get("/getdetail", (req, res) => {
  let info = client.info;
  let datauser = "Connection info : "+info.pushname+ "("+info.me.user+"|Device :"+info.phone.device_model+")";
  res.status(200).json({
    status: true,
    msg: status,
    data: datauser
  });
});
app.get("/deleteses", (req, res) => {
  fs.unlinkSync(SESSION_FILE_PATH, function(err) {
    if(err) return console.log(err);
    console.log('Session file deleted!');
  });
  status = "NOT READY";
  client.destroy();
  client.initialize();
  res.status(200).json({
    status: true,
    msg: "delete session success",
    data: {}
  });
});
app.get("/resetses", (req, res) => {
  client.destroy();
  client.initialize();
  res.status(200).json({
    status: true,
    msg: "reset success",
    data: {}
  });
});

app.post("/clearchat", jsonParser, [body('number').notEmpty()], async(req, res) => {
  const rJid = phoneNumberFormatter(req.body.number);
  console.log("Clear "+rJid);
  let actionRes;
  let chatStatus=await client.getContactById(rJid)
  .then((contact)=>contact.getChat()
  //.then((jid_chat)=>jid_chat.clearMessages()
  .then((jid_chat)=>jid_chat.delete()
  .then((actionres)=>actionRes=actionres)
  .catch(error=>console.log(error))
)
.catch(error=>console.log(error))
)
.catch(error=>console.log(error));

if (actionRes)
{
  res.status(200).json({
    status: true,
    msg: "Berhasil Hapus Chat",
    data: {}
  });
}
else
{
  res.status(200).json({
    status: false,
    msg: "Gagal Hapus Chat",
    data: {}
  });
}
});

app.post("/getChat", jsonParser, [body('number').notEmpty()], async (req, res) => {
  const rJid = phoneNumberFormatter(req.body.number);

  console.log("Get Chats of "+rJid);
  let actionRes;
  let chatStatus=await client.getContactById(rJid)
  .then((contact)=>contact.getChat()
  .then(response=>actionRes=saveChat(response,req.body.latestOnly)))
  .catch(error=>console.log("TASK: ERROR Getting Chats of "+rJid));

  if (actionRes)
  {
    res.status(200).json({
      status: true,
      msg: "Berhasil Download Chats "+rJid,
      data: {}
    });
  }
  else
  {
    res.status(200).json({
      status: false,
      msg: "Gagal Download Chats "+rJid,
      data: {}
    });
  }
});

const checkRegisteredNumber = async function(number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
}

app.post('/syncContacts', jsonParser, [ body('key').notEmpty() ], async (req, res) => {
  let sContacts = await client.getContacts()
  //.then(response=>console.log(response.length));
  //.then(response=>console.log(response));
  .then(response=>getContacts(response));
  return res.status(200).json({
    status: true,
    msg: "Contacts SYNC-ed"
  });
});
// Send message
app.post('/send', [ body('number').notEmpty(), body('message').notEmpty() ], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (status == "NOT READY"){
    return res.status(500).json({
      status: false,
      msg: 'WAW is not ready',
      data: {}
    });
  }

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      msg: errors.mapped(),
      data: {}
    });
  }

  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;
  client.sendMessage(number, message).then(response => {
    const querySt="REPLACE INTO chat_messages VALUES ('"+response.to+"','"+
    response.id.id+"','1',"+
    response.timestamp+",'0',"+
    con.escape(response.body)+",'"+response.ack+"',0,'"+
    response.deviceType+"',0,'',0,0,'','')";

    saveMessageToDB(querySt);
    res.status(200).json({
      status: true,
      msg: "Terkirim",
      data: {response}
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      msg: "Gagal terkirim",
      data: {err}
    });
  });
});
//Send Media
app.post('/send-media', async (req, res) => {
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;
  console.log(fileUrl);
  // const media = MessageMedia.fromFilePath('./image-example.png');
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  let mimetype;
  const attachment = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  }).then(response => {
    mimetype = response.headers['content-type'];
    return response.data.toString('base64');
  });

  const media = new MessageMedia(mimetype, attachment, caption);

  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

server.listen(port, function() {
  console.log('App running on *: ' + port);
});
