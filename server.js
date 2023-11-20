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
  const [pieId, pieValue] = text.trim().split(' ');

  // Make sure pieValue is a number
  const value = Number(pieValue);
  if (isNaN(value) || value < 0) {
    res.send('Invalid number');
    return;
  }

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

    // Include the value property when inserting the pie
    await db.collection('pies').insertOne({ user: user_name, pieId: pieId, ts: result.ts, value: value });
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
    // Retrieve all uneaten pies
    const pies = await db.collection('pies').find({ eaten: { $ne: true } }).toArray();

    // For each pie, calculate the average slice value
    for (const pie of pies) {
      // Retrieve all slices for the pie
      const slices = await db.collection('slices').find({ pieId: pie.pieId }).toArray();

      // Calculate the sum of the slice values
      let sum = slices.reduce((a, b) => a + b.value, 0);

      // Include the original pie amount in the sum
      // Make sure pie.value is a number
      const originalPieValue = Number(pie.value);
      if (!isNaN(originalPieValue)) {
        sum += originalPieValue;
      }

      // Calculate the average slice value
      // The denominator should be the number of slices plus one (for the original pie entry)
      const denominator = slices.length + 1;
      const average = sum / denominator;

      // Store the average slice value in the averages collection
      await db.collection('averages').updateOne(
        { pieId: pie.pieId },
        { $set: { average: average } },
        { upsert: true }
      );

      // Mark the pie as eaten
      await db.collection('pies').updateOne({ pieId: pie.pieId }, { $set: { eaten: true } });
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