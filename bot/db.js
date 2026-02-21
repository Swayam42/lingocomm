
import mongoose from "mongoose";

let isConnected = false;


export async function connectDB(retries = 5) {
  if (isConnected) return;

  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      isConnected = true;
      console.log("MongoDB connected successfully");
      
      // Handle connection errors after initial connection
      mongoose.connection.on('error', (err) => {
        console.error('MongoDB runtime error:', err.message);
      });
      
      mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected. Attempting to reconnect...');
      });
      
      mongoose.connection.on('reconnected', () => {
        console.log('MongoDB reconnected successfully');
      });
      
      return;
    } catch (err) {
      const delay = Math.min(1000 * Math.pow(2, i), 10000); // Max 10s
      console.error(`MongoDB connection failed (attempt ${i + 1}/${retries}): ${err.message}`);
      
      if (i < retries - 1) {
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error("MongoDB connection failed after all retries");
        process.exit(1);
      }
    }
  }
}