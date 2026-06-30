using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class ConsoleBridge {
    // Win32 APIs
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetConsoleScreenBufferInfo(IntPtr hConsoleOutput, out CONSOLE_SCREEN_BUFFER_INFO lpConsoleScreenBufferInfo);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool ReadConsoleOutputCharacter(IntPtr hConsoleOutput, [Out] StringBuilder lpCharacter, uint nLength, COORD dwReadCoord, out uint lpNumberOfCharsRead);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteConsoleInput(IntPtr hConsoleInput, INPUT_RECORD[] lpBuffer, uint nLength, out uint lpNumberOfEventsWritten);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile
    );

    public const uint GENERIC_READ = 0x80000000;
    public const uint GENERIC_WRITE = 0x40000000;
    public const uint FILE_SHARE_READ = 1;
    public const uint FILE_SHARE_WRITE = 2;
    public const uint OPEN_EXISTING = 3;

    public const int STD_OUTPUT_HANDLE = -11;
    public const int STD_INPUT_HANDLE = -10;

    [StructLayout(LayoutKind.Sequential)]
    public struct COORD {
        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SMALL_RECT {
        public short Left;
        public short Top;
        public short Right;
        public short Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CONSOLE_SCREEN_BUFFER_INFO {
        public COORD dwSize;
        public COORD dwCursorPosition;
        public ushort wAttributes;
        public SMALL_RECT srWindow;
        public COORD dwMaximumWindowSize;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUT_RECORD {
        [FieldOffset(0)]
        public ushort EventType;
        [FieldOffset(4)]
        public KEY_EVENT_RECORD KeyEvent;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEY_EVENT_RECORD {
        public bool bKeyDown;
        public ushort wRepeatCount;
        public ushort wVirtualKeyCode;
        public ushort wVirtualScanCode;
        public char UnicodeChar;
        public uint dwControlKeyState;
    }

    // JSON Helper methods (C# 4.0 compatible)
    static string GetJsonValue(string json, string key) {
        int keyIndex = json.IndexOf("\"" + key + "\"");
        if (keyIndex == -1) return null;
        int colonIndex = json.IndexOf(":", keyIndex);
        if (colonIndex == -1) return null;
        int quoteStart = json.IndexOf("\"", colonIndex);
        if (quoteStart == -1) return null;
        
        int index = quoteStart + 1;
        StringBuilder valSb = new StringBuilder();
        while (index < json.Length) {
            char c = json[index];
            if (c == '"') {
                break;
            } else if (c == '\\') {
                if (index + 1 < json.Length) {
                    char next = json[index + 1];
                    if (next == '"') valSb.Append('"');
                    else if (next == '\\') valSb.Append('\\');
                    else if (next == 'n') valSb.Append('\n');
                    else if (next == 'r') valSb.Append('\r');
                    else if (next == 't') valSb.Append('\t');
                    else valSb.Append(next);
                    index += 2;
                    continue;
                }
            }
            valSb.Append(c);
            index++;
        }
        return valSb.ToString();
    }

    static int? GetJsonIntValue(string json, string key) {
        int keyIndex = json.IndexOf("\"" + key + "\"");
        if (keyIndex == -1) return null;
        int colonIndex = json.IndexOf(":", keyIndex);
        if (colonIndex == -1) return null;
        int start = colonIndex + 1;
        while (start < json.Length && (char.IsWhiteSpace(json[start]) || json[start] == ':')) {
            start++;
        }
        int end = start;
        while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '-')) {
            end++;
        }
        if (end > start) {
            int val;
            if (int.TryParse(json.Substring(start, end - start), out val)) {
                return val;
            }
        }
        return null;
    }

    static string EscapeString(string s) {
        StringBuilder sb = new StringBuilder();
        foreach (char c in s) {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c == '\b') sb.Append("\\b");
            else if (c == '\f') sb.Append("\\f");
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < ' ') sb.AppendFormat("\\u{0:x4}", (int)c);
            else sb.Append(c);
        }
        return sb.ToString();
    }

    public static void Main(string[] args) {
        if (args.Length < 1) {
            Console.WriteLine("{\"status\":\"error\",\"message\":\"Missing PID argument\"}");
            return;
        }

        uint pid;
        if (!uint.TryParse(args[0], out pid)) {
            Console.WriteLine("{\"status\":\"error\",\"message\":\"Invalid PID format\"}");
            return;
        }

        // Detach from current console (if any) and attach to target PID
        FreeConsole();
        bool attached = false;
        int retries = 15;
        int lastError = 0;
        for (int i = 0; i < retries; i++) {
            if (AttachConsole(pid)) {
                attached = true;
                break;
            }
            lastError = Marshal.GetLastWin32Error();
            Thread.Sleep(200);
        }

        if (!attached) {
            Console.WriteLine("{\"status\":\"error\",\"message\":\"Failed to attach console to PID " + pid + " after " + retries + " retries. Error: " + lastError + "\"}");
            return;
        }

        IntPtr hOutput = CreateFile("CONOUT$", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        IntPtr hInput = CreateFile("CONIN$", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);

        // Notify client we are attached
        Console.WriteLine("{\"status\":\"attached\",\"pid\":" + pid + "}");

        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                if (line.Contains("\"action\":\"read\"") || line.Contains("\"action\": \"read\"")) {
                    CONSOLE_SCREEN_BUFFER_INFO info;
                    if (!GetConsoleScreenBufferInfo(hOutput, out info)) {
                        Console.WriteLine("{\"status\":\"error\",\"message\":\"Failed to get screen buffer info. Error: " + Marshal.GetLastWin32Error() + "\"}");
                        continue;
                    }

                    short left = info.srWindow.Left;
                    short top = info.srWindow.Top;
                    short right = info.srWindow.Right;
                    short bottom = info.srWindow.Bottom;
                    short width = (short)(right - left + 1);
                    short height = (short)(bottom - top + 1);

                    StringBuilder visibleText = new StringBuilder();
                    for (short row = top; row <= bottom; row++) {
                        COORD coord = new COORD { X = left, Y = row };
                        StringBuilder rowText = new StringBuilder(width);
                        rowText.Length = width;
                        uint read;
                        ReadConsoleOutputCharacter(hOutput, rowText, (uint)width, coord, out read);
                        string lineStr = rowText.ToString(0, (int)read);
                        visibleText.Append(lineStr.PadRight(width)).Append("\n");
                    }

                    // Also support scrollback if requested (reads last 100 rows of history above top)
                    StringBuilder scrollbackText = new StringBuilder();
                    if (line.Contains("\"scrollback\":true") || line.Contains("\"scrollback\": true")) {
                        short startRow = (short)Math.Max(0, top - 100);
                        for (short row = startRow; row < top; row++) {
                            COORD coord = new COORD { X = 0, Y = row };
                            StringBuilder rowText = new StringBuilder(info.dwSize.X);
                            rowText.Length = info.dwSize.X;
                            uint read;
                            ReadConsoleOutputCharacter(hOutput, rowText, (uint)info.dwSize.X, coord, out read);
                            string lineStr = rowText.ToString(0, (int)read);
                            scrollbackText.Append(lineStr).Append("\n");
                        }
                    }

                    Console.WriteLine("{" +
                        "\"status\":\"success\"," +
                        "\"data\":{" +
                            "\"windowHandle\":\"0x" + GetConsoleWindow().ToString("X") + "\"," +
                            "\"visible\":\"" + EscapeString(visibleText.ToString()) + "\"," +
                            "\"scrollback\":\"" + EscapeString(scrollbackText.ToString()) + "\"," +
                            "\"cursorX\":" + info.dwCursorPosition.X + "," +
                            "\"cursorY\":" + info.dwCursorPosition.Y + "," +
                            "\"cols\":" + info.dwSize.X + "," +
                            "\"rows\":" + info.dwSize.Y + "," +
                            "\"windowLeft\":" + left + "," +
                            "\"windowTop\":" + top + "," +
                            "\"windowWidth\":" + width + "," +
                            "\"windowHeight\":" + height +
                        "}" +
                    "}");
                }
                else if (line.Contains("\"action\":\"write\"") || line.Contains("\"action\": \"write\"")) {
                    string text = GetJsonValue(line, "text");
                    if (text == null) {
                        Console.WriteLine("{\"status\":\"error\",\"message\":\"Missing text parameter\"}");
                        continue;
                    }

                    // Write each character to console input buffer
                    uint totalWritten = 0;
                    foreach (char c in text) {
                        INPUT_RECORD[] records = new INPUT_RECORD[2];
                        
                        records[0] = new INPUT_RECORD {
                            EventType = 1, // KEY_EVENT
                            KeyEvent = new KEY_EVENT_RECORD {
                                bKeyDown = true,
                                wRepeatCount = 1,
                                wVirtualKeyCode = 0,
                                wVirtualScanCode = 0,
                                UnicodeChar = c,
                                dwControlKeyState = 0
                            }
                        };
                        records[1] = new INPUT_RECORD {
                            EventType = 1,
                            KeyEvent = new KEY_EVENT_RECORD {
                                bKeyDown = false,
                                wRepeatCount = 1,
                                wVirtualKeyCode = 0,
                                wVirtualScanCode = 0,
                                UnicodeChar = c,
                                dwControlKeyState = 0
                            }
                        };
                        
                        uint written;
                        if (WriteConsoleInput(hInput, records, 2, out written)) {
                            totalWritten += written;
                        }
                    }

                    Console.WriteLine("{\"status\":\"success\",\"eventsWritten\":" + totalWritten + "}");
                }
                else if (line.Contains("\"action\":\"key\"") || line.Contains("\"action\": \"key\"")) {
                    int? keyCodeVal = GetJsonIntValue(line, "keyCode");
                    int? controlStateVal = GetJsonIntValue(line, "controlState");

                    if (keyCodeVal == null) {
                        Console.WriteLine("{\"status\":\"error\",\"message\":\"Missing keyCode parameter\"}");
                        continue;
                    }

                    ushort vkCode = (ushort)keyCodeVal.Value;
                    uint ctrlState = controlStateVal.HasValue ? (uint)controlStateVal.Value : 0;
                    ushort scanCode = (ushort)MapVirtualKey(vkCode, 0);

                    char unicodeChar = '\0';
                    if (vkCode == 13) unicodeChar = '\r';
                    else if (vkCode == 9) unicodeChar = '\t';
                    else if (vkCode == 8) unicodeChar = '\b';
                    else if (vkCode == 27) unicodeChar = (char)27;

                    INPUT_RECORD[] records = new INPUT_RECORD[2];
                    records[0] = new INPUT_RECORD {
                        EventType = 1,
                        KeyEvent = new KEY_EVENT_RECORD {
                            bKeyDown = true,
                            wRepeatCount = 1,
                            wVirtualKeyCode = vkCode,
                            wVirtualScanCode = scanCode,
                            UnicodeChar = unicodeChar,
                            dwControlKeyState = ctrlState
                        }
                    };
                    records[1] = new INPUT_RECORD {
                        EventType = 1,
                        KeyEvent = new KEY_EVENT_RECORD {
                            bKeyDown = false,
                            wRepeatCount = 1,
                            wVirtualKeyCode = vkCode,
                            wVirtualScanCode = scanCode,
                            UnicodeChar = unicodeChar,
                            dwControlKeyState = ctrlState
                        }
                    };

                    uint written;
                    if (WriteConsoleInput(hInput, records, 2, out written)) {
                        Console.WriteLine("{\"status\":\"success\",\"eventsWritten\":" + written + "}");
                    } else {
                        Console.WriteLine("{\"status\":\"error\",\"message\":\"WriteConsoleInput failed. Error: " + Marshal.GetLastWin32Error() + "\"}");
                    }
                }
                else if (line.Contains("\"action\":\"focus\"") || line.Contains("\"action\": \"focus\"")) {
                    IntPtr hWindow = GetConsoleWindow();
                    if (hWindow != IntPtr.Zero) {
                        bool focused = SetForegroundWindow(hWindow);
                        Console.WriteLine("{\"status\":\"success\",\"focused\":" + (focused ? "true" : "false") + "}");
                    } else {
                        Console.WriteLine("{\"status\":\"error\",\"message\":\"No console window handle found\"}");
                    }
                }
                else if (line.Contains("\"action\":\"close\"") || line.Contains("\"action\": \"close\"")) {
                    FreeConsole();
                    Console.WriteLine("{\"status\":\"success\",\"closed\":true}");
                    break;
                }
                else {
                    Console.WriteLine("{\"status\":\"error\",\"message\":\"Unknown action\"}");
                }
            } catch (Exception ex) {
                Console.WriteLine("{\"status\":\"error\",\"message\":\"" + EscapeString(ex.Message) + "\"}");
            }
        }
    }
}
