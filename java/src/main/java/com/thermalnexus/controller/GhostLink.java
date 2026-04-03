package com.thermalnexus.controller;

import java.io.RandomAccessFile;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;

/**
 * Shared memory segment implementation (MappedByteBuffer) 
 * to act as the GhostLink bridge for incoming fan speed commands.
 * 
 * Data Layout (16 bytes):
 * [0-3] : Magic Bytes ("GHLK")
 * [4-7] : Target PWM (int)
 * [8-15] : Last Updated Timestamp (long)
 */
public class GhostLink {
    private MappedByteBuffer buffer;
    private FileChannel channel;
    
    public GhostLink(Path memoryFile) {
        try {
            RandomAccessFile file = new RandomAccessFile(memoryFile.toFile(), "rw");
            channel = file.getChannel();
            buffer = channel.map(FileChannel.MapMode.READ_WRITE, 0, 16);
        } catch (Exception e) {
            throw new RuntimeException("Failed to initialize GhostLink shared memory", e);
        }
    }

    public int getTargetPwm() {
        return buffer.getInt(4);
    }

    public long getLastHeartbeat() {
        return buffer.getLong(8);
    }

    public void close() {
        try {
            if (channel != null) channel.close();
        } catch (Exception ignored) {}
    }
}
