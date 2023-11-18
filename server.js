require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { createEventAdapter } = require('@slack/events-api');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
app.use('/slack/events', (req, res, next) => {
  if (req.body.type === 'url_verification') {
    res.send(req.body.challenge);
  } else {
    next();
  }
});



app.use('/slack/events', slackEvents.requestListener());

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
      console.log('Received a message event');
      if (event.thread_ts) {
        const pie = await db.collection('pies').findOne({ ts: event.thread_ts });
        if (pie) {
          const sliceValue = parseFloat(event.text.replace('#', ''));
          if (!isNaN(sliceValue) && sliceValue >= 0) {
            await db.collection('slices').insertOne({ user: event.user, pieId: pie.pieId, value: sliceValue });
    
            // Post a reply to the thread
            await slackClient.chat.postMessage({
              channel: event.channel,
              text: `Slice for pie ${pie.pieId} has been added by ${event.user}`,
              thread_ts: event.thread_ts
            });
          }
        }
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

  const pieId = text.trim();

  try {
    const result = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `Pie ${pieId} has been added by ${user_name}`
    });

    const threadResult = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `Thread started for pie ${pieId}`,
      thread_ts: result.ts
    });

    await db.collection('pies').insertOne({ user: user_name, pieId: pieId, ts: threadResult.ts });
    res.send('');
  } catch (err) {
    console.error('Error handling /pie command', err);
    res.send('Error handling /pie command');
  }
}

async function handleSlicePieCommand(user_name, text, res) {
  const [pieId, sliceValue] = text.trim().split(' ');
  const slice = parseFloat(sliceValue);

  if (isNaN(slice) || slice < 0) {
    res.send('Invalid number');
    return;
  }

  const pie = await db.collection('pies').findOne({ pieId: pieId });
  if (!pie) {
    res.send('Invalid pie ID');
    return;
  }

  try {
    await db.collection('slices').insertOne({ user: user_name, pieId: pieId, value: slice });
    const result = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `Slice for pie ${pieId} has been added by ${user_name}`,
      thread_ts: pie.ts
    });

    res.send(`Slice for pie ${pieId} has been added by ${user_name}`);
  } catch (err) {
    console.error('Error handling /slicepie command', err);
    res.send('Error handling /slicepie command');
  }
}

// Define a function to handle the /eatpie command
async function handleEatPieCommand(res) {
  try {
    // Retrieve all pies
    const pies = await db.collection('pies').find().toArray();

    // For each pie, calculate the average slice value
    for (const pie of pies) {
      // Retrieve all slices for the pie
      const slices = await db.collection('slices').find({ pieId: pie.pieId }).toArray();

      // Calculate the sum of the slice values
      const sum = slices.reduce((a, b) => a + b.value, 0);

      // Calculate the average slice value
      const average = sum / slices.length;

      // Store the average slice value in the averages collection
      await db.collection('averages').updateOne(
        { pieId: pie.pieId },
        { $set: { average: average } },
        { upsert: true }
      );
    }

    // Retrieve all averages
    const averages = await db.collection('averages').find().toArray();

    // Send a message with the averages
    let message = 'Averages:\n';
    for (const average of averages) {
      message += `Pie ${average.pieId}: ${average.average}\n`;
    }
    res.send(message);
  } catch (err) {
    console.error('Error calculating averages', err);
    res.send('Error calculating averages');
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