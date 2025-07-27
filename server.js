const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: ['http://localhost:5000', 'http://127.0.0.1:5000'],
  credentials: true
}));

// Body parser middleware - MUST come before routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/studysphere', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  streak: {
    count: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: null }
  },
  timezone: { type: String, default: 'UTC' },
  feedbacks: [{
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now }
  }],
  todoTasks: [{
    title: { type: String, required: true },
    description: { type: String, required: true },
    dueDate: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
  }]
});

const User = mongoose.model('User', userSchema);

// Login Route
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Username and password are required' 
      });
    }
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials' 
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        streak: user.streak.count
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// Signup Route
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password, phone } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, email and password are required'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      username,
      email,
      phone: phone || '',
      password: hashedPassword,
      streak: {
        count: 1,
        lastUpdated: new Date()
      }
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        streak: user.streak.count
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    
    if (error.code === 11000) {
      const field = error.message.includes('username') ? 'username' : 'email';
      return res.status(400).json({
        success: false,
        message: `${field} already exists`,
        field: field
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during signup'
    });
  }
});

// Streak Route
app.get('/api/streak', async (req, res) => {
  try {
    const userId = req.query.userId;
    const timezone = req.query.timezone || 'UTC';
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const now = new Date();
    const lastUpdated = user.streak.lastUpdated ? new Date(user.streak.lastUpdated) : null;
    
    const todayLocal = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const lastUpdatedLocal = lastUpdated ? 
        new Date(lastUpdated.toLocaleString('en-US', { timeZone: timezone })) : null;

    todayLocal.setHours(0, 0, 0, 0);
    const yesterdayLocal = new Date(todayLocal);
    yesterdayLocal.setDate(yesterdayLocal.getDate() - 1);

    let streakChanged = false;
    let newStreak = user.streak.count;

    if (!lastUpdatedLocal) {
      newStreak = 1;
      streakChanged = true;
    } else {
      lastUpdatedLocal.setHours(0, 0, 0, 0);
      
      const dayDiff = Math.floor((todayLocal - lastUpdatedLocal) / (1000 * 60 * 60 * 24));
      
      if (dayDiff === 0) {
        newStreak = user.streak.count;
      } else if (dayDiff === 1) {
        newStreak = user.streak.count + 1;
        streakChanged = true;
      } else if (dayDiff > 1) {
        newStreak = 1;
        streakChanged = true;
      }
    }

    const newLongest = Math.max(user.streak.longest, newStreak);
    
    if (streakChanged) {
      await User.updateOne(
        { _id: userId },
        { 
          $set: { 
            'streak.count': newStreak,
            'streak.longest': newLongest,
            'streak.lastUpdated': now,
            'timezone': timezone
          } 
        }
      );
    }

    res.json({
      success: true,
      streak: {
        current: newStreak,
        longest: newLongest,
        lastUpdated: now
      },
      timezone: timezone
    });

  } catch (error) {
    console.error('Streak error:', error);
    res.status(500).json({ success: false, message: 'Error calculating streak' });
  }
});

// Feedback Route
app.post('/api/feedback', async (req, res) => {
  try {
    const { userId, rating, text } = req.body;
    
    if (!userId || !rating) {
      return res.status(400).json({ 
        success: false, 
        message: 'userId and rating are required' 
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    user.feedbacks.push({
      rating: parseInt(rating),
      text: text || '',
      createdAt: new Date()
    });

    const savedUser = await user.save();

    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      feedback: savedUser.feedbacks[savedUser.feedbacks.length - 1]
    });

  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error submitting feedback',
      error: error.message
    });
  }
});

// Todo Routes
app.post('/api/todo', async (req, res) => {
  try {
    const { userId, title, description, dueDate } = req.body;
    
    if (!userId || !title || !description || !dueDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    user.todoTasks.push({
      title,
      description,
      dueDate: new Date(dueDate)
    });

    const savedUser = await user.save();

    res.json({
      success: true,
      message: 'Todo task added successfully',
      task: savedUser.todoTasks[savedUser.todoTasks.length - 1]
    });

  } catch (error) {
    console.error('Todo error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error adding todo task',
      error: error.message
    });
  }
});

app.delete('/api/todo/:userId/:taskId', async (req, res) => {
  try {
    const { userId, taskId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)){
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid user ID' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const taskIndex = user.todoTasks.findIndex(task => task._id.toString() === taskId);
    if (taskIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        message: 'Task not found' 
      });
    }

    user.todoTasks.splice(taskIndex, 1);
    await user.save();

    res.json({
      success: true,
      message: 'Todo task deleted successfully'
    });

  } catch (error) {
    console.error('Todo delete error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting todo task',
      error: error.message
    });
  }
});

app.get('/api/todo/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid user ID' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      tasks: user.todoTasks
    });

  } catch (error) {
    console.error('Todo fetch error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching todo tasks',
      error: error.message
    });
  }
});

// All other routes...
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}`);
});