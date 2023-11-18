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
  db = client.db();
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
  // Split the text into a number and a text string
  const [number, ...textArray] = text.split(' ');
  const textString = textArray.join(' ');

  // Convert the number to a float
  const pie = parseFloat(number);

  // If the number is not a valid number, send an error message
  if (isNaN(pie) || pie < 0) {
    res.send('Invalid number');
    return;
  }

  // Add the pie to the user's total pie and the channel's total pie
  try {
    await db.collection('users').updateOne(
      { name: user_name },
      { $inc: { totalPie: pie } },
      { upsert: true }
    );

    await db.collection('channels').updateOne(
      { name: process.env.CHANNEL_NAME },
      { $inc: { totalPie: pie } },
      { upsert: true }
    );

    res.send(`Added ${pie} to ${user_name}'s total pie`);
  } catch (err) {
    console.error('Error updating total pie', err);
    res.send('Error updating total pie');
  }
}

// Define a function to handle the /slicepie command
async function handleSlicePieCommand(user_name, text, res) {
  // Split the text into a username, a number, and a text string
  const [username, number, ...textArray] = text.split(' ');
  const textString = textArray.join(' ');

  // Convert the number to a float
  const pie = parseFloat(number);

  // If the number is not a valid number, send an error message
  if (isNaN(pie) || pie < 0) {
    res.send('Invalid number');
    return;
  }

  // Add the pie to the user's total pie and the channel's total pie
  try {
    await db.collection('users').updateOne(
      { name: username },
      { $inc: { totalPie: pie } },
      { upsert: true }
    );

    await db.collection('channels').updateOne(
      { name: process.env.CHANNEL_NAME },
      { $inc: { totalPie: pie } },
      { upsert: true }
    );

    res.send(`Added ${pie} to ${username}'s total pie`);
  } catch (err) {
    console.error('Error updating total pie', err);
    res.send('Error updating total pie');
  }
}

// Define a function to handle the /eatpie command
async function handleEatPieCommand(res) {
  try {
    // Retrieve the total pie for the channel
    const channel = await db.collection('channels').findOne({ name: process.env.CHANNEL_NAME });

    // If the channel doesn't exist or has no pie, send an error message
    if (!channel || !channel.totalPie) {
      res.send('No pie in the channel');
      return;
    }

    // Retrieve the total pie for each user
    const users = await db.collection('users').find().toArray();

    // Calculate each user's claim and send a message with the claims
    let claims = '';
    for (const user of users) {
      const claim = user.totalPie / channel.totalPie;
      claims += `${user.name}: ${claim}\n`;
    }

    res.send(`Claims:\n${claims}`);
  } catch (err) {
    console.error('Error retrieving total pie', err);
    res.send('Error retrieving total pie');
  }
}

app.get('/test-db-connection', async (req, res) => {
  try {
    const client = await MongoClient.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.close();
    res.send('Successfully connected to the database');
  } catch (err) {
    console.error('Failed to connect to the database', err);
    res.send('Failed to connect to the database');
  }
});

app.get('/', (req, res) => {
  res.send('Hello, world!');
});

// Start the server
app.listen(process.env.PORT || 3000, () => {
  console.log('Server is running');
});