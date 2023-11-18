require('dotenv').config();
// Import the necessary modules
const express = require('express');
const bodyParser = require('body-parser');
const MongoClient = require('mongodb').MongoClient;

// Create a new Express application
const app = express();

// Use body-parser middleware to parse request bodies
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Declare a variable to hold our database connection
let db;

// Connect to the MongoDB database
MongoClient.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pie', (err, client) => {
  // If there's an error, log it and exit
  if (err) {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  }

  // Otherwise, log a success message and store the database connection
  console.log('Connected to MongoDB');
  db = client.db('pie');
});

// Define a route to handle Slack slash commands
app.post('/slack/commands', (req, res) => {
  // Extract the command, text, and user_name from the request body
  const { command, text, user_name } = req.body;

  // Depending on the command, call a different function
  switch (command) {
    case '/pie':
      handlePieCommand(user_name, text, res);
      break;
    case '/slicepie':
      handleSlicePieCommand(user_name, text, res);
      break;
    case '/eatpie':
      handleEatPieCommand(res);
      break;
    default:
      res.send('Invalid command');
  }
});

// Define a function to handle the /pie command
async function handlePieCommand(user_name, text, res) {
  const { WebClient } = require('@slack/web-api');

const slackClient = new WebClient(process.env.SLACK_TOKEN);

  const pieId = text.trim();

  try {
    // Post a new message for the /pie command
    const result = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `Pie ${pieId} has been added by ${user_name}`
    });

    // Store the ts value of the message in the database
    await db.collection('pies').insertOne({ user: user_name, pieId: pieId, ts: result.ts });

    res.send('');
  } catch (err) {
    console.error('Error handling /pie command', err);
    res.send('Error handling /pie command');
  }
}

// Define a function to handle the /slicepie command
async function handleSlicePieCommand(user_name, text, res) {
  // Extract the pie ID and the slice value from the command text
  const [pieId, sliceValue] = text.trim().split(' ');

  // Convert the slice value to a number
  const slice = parseFloat(sliceValue);

  // If the slice value is not a valid number, send an error message
  if (isNaN(slice) || slice < 0) {
    res.send('Invalid number');
    return;
  }

  // Check if the pie exists
  const pie = await db.collection('pies').findOne({ pieId: pieId });
  if (!pie) {
    res.send('Invalid pie ID');
    return;
  }

  try {
    // Add the slice to the slices collection with the user's name and the pie ID
    await db.collection('slices').insertOne({ user: user_name, pieId: pieId, value: slice });

    res.send(`Slice for pie ${pieId} has been added by ${user_name}`);
  } catch (err) {
    console.error('Error handling /slicepie command', err);
    res.send('Error handling /slicepie command');
  }
  try {
    // Post a new message to the thread
    const result = await slackClient.chat.postMessage({
      channel: process.env.CHANNEL_ID,
      text: `Slice for pie ${pieId} has been added by ${user_name}`,
      thread_ts: thread_ts  // post the message to the thread
    });

    // ... rest of your code ...
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

// Start the server
app.listen(process.env.PORT || 3000, () => {
  console.log('Server is running');
});