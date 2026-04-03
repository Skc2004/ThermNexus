package com.thermalnexus.controller;

import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;

/**
 * Ultra-fast write-loop using the Foreign Function & Memory (FFM) API 
 * directly calling libc open/write/close.
 */
public class HwmonWriter {
    private static final Linker linker = Linker.nativeLinker();
    private static final SymbolLookup stdlib = linker.defaultLookup();
    
    private static final MethodHandle open;
    private static final MethodHandle write;
    private static final MethodHandle close;

    public static final int O_WRONLY = 01;

    static {
        open = linker.downcallHandle(
            stdlib.find("open").orElseThrow(),
            FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.ADDRESS, ValueLayout.JAVA_INT)
        );
        write = linker.downcallHandle(
            stdlib.find("write").orElseThrow(),
            FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.JAVA_INT, ValueLayout.ADDRESS, ValueLayout.JAVA_LONG)
        );
        close = linker.downcallHandle(
            stdlib.find("close").orElseThrow(),
            FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.JAVA_INT)
        );
    }

    public static void writePwm(String path, int pwmValue) {
        String valueStr = String.valueOf(pwmValue) + "\n";
        
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment pathSegment = arena.allocateUtf8String(path);
            MemorySegment valueSegment = arena.allocateUtf8String(valueStr);
            
            int fd = (int) open.invokeExact(pathSegment, 1);
            if (fd >= 0) {
                // write
                write.invokeExact(fd, valueSegment, (long) valueStr.length());
                // close
                close.invokeExact(fd);
            } else {
                System.err.println("FFM write failure. Cannot open: " + path);
            }
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }
}
