require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { createEventAdapter } = require('@slack/events-api');

const app = express();

const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
// Add this line right after the slackEvents constant
app.use('/slack/events', slackEvents.requestListener());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());


// Make sure any body parser middleware is added after the slackEvents.requestListener() middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



app.use('/slack/events', (req, res, next) => {
  if (req.body.type === 'url_verification') {
    res.send(req.body.challenge);
  } else {
    next();
  }
});



const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pie';
let db;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_TOKEN);

async function run() {
  try {
    await client.connect();
    db = client.db('pie');
    console.log("Connected to MongoDB!");

    slackEvents.on('message', async (event) => {
      try {
        // Ignore messages from the bot itself
        if (event.bot_id) {
          return;
        }
    
        console.log('Received a message event', event);
        if (event.thread_ts) {
          const thread_ts = parseFloat(event.thread_ts).toFixed(6); // Round to 6 decimal places
          const pie = await db.collection('pies').findOne({ ts: thread_ts }); // Use rounded thread_ts
          console.log('Found pie', pie);
          if (pie) {
            const match = event.text.match(/\d+/);
            if (match) {
              const sliceValue = parseFloat(match[0]);
              console.log('Parsed slice value', sliceValue);
              if (!isNaN(sliceValue) && sliceValue >= 0) {
                await db.collection('slices').insertOne({ user: event.user, pieId: pie.pieId, value: sliceValue });
                console.log('Inserted slice');
    
                await slackClient.chat.postMessage({
                  channel: event.channel,
                  text: `Slice for pie ${pie.pieId} has been added by ${event.user}`,
                  thread_ts: event.thread_ts
                });
              }
            }
          }
        }
      } catch (err) {
        console.error('Error handling message event', err);
      }
    });

    app.post('/slack/commands', (req, res) => {
      const { command, text, user_name } = req.body;
      switch (command) {
        case '/pie':
          handlePieCommand(user_name, text, res);
          break;
        case '/eatpie':
          handleEatPieCommand(res);
          break;
        default:
          res.send('Invalid command');
      }
    });

    app.listen(process.env.PORT || 3000, () => {
      console.log('Server is running');
    });

  } catch (err) {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  }
}


run().catch(console.dir);

async function handlePieCommand(user_name, text, res) {
  const pieValue = text.trim().split(/\s+/)[0];
  const pieId = text.trim().substring(pieValue.length).trim();

  // Make sure pieValue is a number
  const value = Number(pieValue);
  if (isNaN(value) || value < 0) {
    res.send('Invalid number');
    return;
  }

  try {
    const result = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `Pie ${pieId} with value ${value} has been added by ${user_name}`
    });

    const threadResult = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `Thread started for pie ${pieId}`,
      thread_ts: result.ts
    });

    // Include the value and eaten properties when inserting the pie
    await db.collection('pies').insertOne({ user: user_name, pieId: pieId, ts: result.ts, value: value, eaten: false });
    res.send('');
  } catch (err) {
    console.error('Error handling /pie command', err);
    res.send('Error handling /pie command');
  }
}

async function handleSlicePieCommand(user_name, text, res) {
  const sliceValue = text.trim().split(/\s+/)[0];
  const pieId = text.trim().substring(sliceValue.length).trim();

  // Make sure sliceValue is a number
  const value = Number(sliceValue);
  if (isNaN(value) || value < 0) {
    res.send('Invalid number');
    return;
  }

  try {
    const pie = await db.collection('pies').findOne({ pieId: pieId });
    if (!pie) {
      res.send('Pie not found');
      return;
    }

    await db.collection('slices').insertOne({ user: user_name, pieId: pieId, value: value });

    const result = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `Slice with value ${value} has been added to pie ${pieId} by ${user_name}`
    });

    res.send('');
  } catch (err) {
    console.error('Error handling /slice command', err);
    res.send('Error handling /slice command');
  }
}

// Define a function to handle the /eatpie command
async function handleEatPieCommand(user_name, text, res) {
  try {
    const pies = await db.collection('pies').find({ eaten: false }).toArray();
    let totalValue = 0;
    let totalCount = 0;

    for (let pie of pies) {
      const slices = await db.collection('slices').find({ pieId: pie.pieId }).toArray();
      let pieValue = pie.value;
      let sliceCount = slices.length;

      if (sliceCount > 0) {
        for (let slice of slices) {
          pieValue += slice.value;
        }
        totalValue += pieValue / (sliceCount + 1);
      } else {
        totalValue += pieValue;
      }

      totalCount++;
    }

    const averageValue = totalValue / totalCount;

    const result = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `The average pie value is ${averageValue}`
    });

    res.send('');
  } catch (err) {
    console.error('Error handling /eatpie command', err);
    res.send('Error handling /eatpie command');
  }
}

// Add the /test-db-connection route
app.get('/test-db-connection', async (req, res) => {
  try {
    // Use the connection to get the server status
    const serverStatus = await db.command({ serverStatus: 1 });

    // If the command was successful, send a success message
    res.send('Database connection is working');
  } catch (err) {
    // If the command failed, send an error message
    res.send('Database connection is not working');
  }
});