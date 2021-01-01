const WebSocket = require('ws');
const express = require('express');
const app = express();
const path = require('path')

const server = require('http').createServer(app);
const wss = new WebSocket.Server({server});

//include google stt
const speech = require('@google-cloud/speech');
const client = new speech.SpeechClient();

// for db access
const mysql = require('mysql');

require('dot-env');


// config stt transcription request
const request = {
    config: {
        encoding: "MULAW",
        sampleRateHertz: 8000, 
        languageCode: "en-GB"
    },
    interimResults: true
};

//handle web socket connection 
wss.on('connection', function connection(ws) {
    console.log("new connection initiated");

    let recognizeStream = null;
    let triggered = false;

    //each second of the message
    ws.on('message', function incoming(message) {
        const msg = JSON.parse(message);
        
        switch(msg.event) {
            // while talking
            case "connected":
                console.log('a new call has connected');

                // create stream to google api 
                recognizeStream = client
                    .streamingRecognize(request)
                    .on('error', console.error)
                    .on('data', data => {
                        let transcription = data.results[0].alternatives[0].transcript;
                        console.log(data.results[0].alternatives[0].transcript);

                        if (transcription.includes('debt') || transcription.includes('collect')){
                            console.log("WOOHOO")
                            triggered = true;
                        }

                        // sending transcription to html 
                        wss.clients.forEach( client => {
                            if (client.readyState === WebSocket.OPEN){
                                client.send(
                                    JSON.stringify({
                                        event: "interim-transcription",
                                        text: data.results[0].alternatives[0].transcript
                                    })
                                );
                            }
                        });
                    });
                break;
            // once at beginning of call
            case "start":
                if (triggered) {
                    console.log(msg.start.callSid)
                }
                
                console.log(`Starting media stream ${msg.streamSid}`);
                break;  
            // giving each audio byte to the 
            case "media":
                recognizeStream.write(msg.media.payload);
                break;
            case "stop":
                // if utterance was recognized
                if (triggered) {
                    console.log(msg.stop.callSid)
                    // get call id
                    let callSID = msg.stop.callSid;
                    // get caller 
                    const client = require('twilio')(process.env.API_KEY, process.env.AUTH_TOKEN);
                    client.calls(callSID)
                    .fetch()
                    .then(call => {
                        console.log(call.from)
                        
                        var con = mysql.createConnection({
                            host: "10.0.0.76",
                            user: "newuser",
                            password: "newpassword",
                            database: 'cadric'
                        });
                        
                        con.connect(function(err) {
                            if (err) {
                                console.log(err)
                            }
                            console.log("Connected!");
                            var sql = `INSERT INTO phone (number) VALUES ('${call.from}')`;
                            con.query(sql, function (err, result) {
                                if (err) throw err;
                                console.log("1 record inserted");
                                //con.destroy();
                            });
                        });

                        //con.destroy();

                    });
                }
                
                recognizeStream.destroy();
                break;
        }
    })
})

app.get('/ping', (req, res) => res.send('ok'));

app.post('/', (req, res) => {
    res.set("Content-Type", "text/xml");

    res.send(`
    <Response>
        <Start>
            <Stream url="wss://${req.headers.host}/"/>
        </Start>
        <Say>I will stream the next 60 second of audio through your websocket</Say>
        <Pause length="60"/>
    </Response>
    `);
})

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {console.log(`server listening at port ${PORT}`)});