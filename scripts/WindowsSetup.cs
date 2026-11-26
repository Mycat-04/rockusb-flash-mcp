using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

internal static class WindowsSetup
{
    private static readonly string Version = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
    private static readonly StringBuilder Transcript = new StringBuilder();

    [DllImport("kernel32.dll")]
    private static extern uint GetConsoleProcessList([Out] uint[] processes, uint count);

    // ProcessStartInfo on .NET Framework takes one command line. Preserve each argument
    // under Windows' rules for backslashes before quotes and the closing quote.
    private static string Quote(string value)
    {
        var quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { ++slashes; continue; }
            if (character == '"') quoted.Append('\\', slashes + 1);
            quoted.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        return quoted.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static void Extract(string directory)
    {
        using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("windows.zip"))
        using (var zip = new ZipArchive(resource, ZipArchiveMode.Read)) {
            foreach (string name in new[] { "node.exe", "setup-windows.mjs", "app.tgz", "release.json", "NODE-LICENSE.txt" }) {
                var entry = zip.GetEntry("./" + name) ?? zip.GetEntry(name);
                if (entry == null) throw new InvalidDataException("Missing installer file: " + name);
                using (var source = entry.Open())
                using (var dest = new FileStream(Path.Combine(directory, name), FileMode.CreateNew, FileAccess.Write)) {
                    source.CopyTo(dest);
                }
            }
        }
    }

    private static void Report(string line, bool error)
    {
        if (line == null) return;
        lock (Transcript) {
            Transcript.AppendLine(line);
            (error ? Console.Error : Console.Out).WriteLine(line);
        }
    }

    private static int RunInstaller(string directory, string[] args)
    {
        var arguments = new List<string> { Quote(Path.Combine(directory, "setup-windows.mjs")) };
        foreach (string arg in args) arguments.Add(Quote(arg));
        var start = new ProcessStartInfo(Path.Combine(directory, "node.exe"), string.Join(" ", arguments)) {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        using (var child = new Process { StartInfo = start }) {
            child.OutputDataReceived += (sender, e) => Report(e.Data, false);
            child.ErrorDataReceived += (sender, e) => Report(e.Data, true);
            child.Start();
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            child.WaitForExit();
            return child.ExitCode;
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length == 1 && (args[0] == "--version" || args[0] == "-v")) {
            Console.WriteLine(Version);
            return 0;
        }
        if (args.Length == 1 && (args[0] == "--help" || args[0] == "-h" || args[0] == "/?")) {
            Console.WriteLine("RockUSB Setup " + Version + " for Windows x64");
            Console.WriteLine("RockUSB-Setup.exe [--client auto|codex|claude|none] [--firmware-dir DIR]");
            Console.WriteLine("                 [--target DIR] [--cache DIR] [--stage-only]");
            Console.WriteLine("Double-click to install and register available clients. Use --stage-only to prepare files without driver installation or client registration.");
            return 0;
        }

        string run = "RockUSB-Setup-" + Guid.NewGuid().ToString("N");
        string directory = Path.Combine(Path.GetTempPath(), run);
        int result = 1;
        try {
            Report("Preparing RockUSB Setup " + Version + "...", false);
            Directory.CreateDirectory(directory);
            Extract(directory);
            result = RunInstaller(directory, args);
        } catch (Exception e) {
            Report(e.Message, true);
        } finally {
            try { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
            catch (IOException e) { Report(e.Message, true); }
            catch (UnauthorizedAccessException e) { Report(e.Message, true); }
        }
        if (result != 0) {
            string log = Path.Combine(Path.GetTempPath(), run + ".log");
            try {
                File.WriteAllText(log, Transcript.ToString(), Encoding.UTF8);
                Console.Error.WriteLine("Setup failed. Log: " + log);
            } catch (IOException e) { Console.Error.WriteLine(e.Message); }
            catch (UnauthorizedAccessException e) { Console.Error.WriteLine(e.Message); }
        }
        // Explorer gives the installer a new console. Keep the result on screen there.
        if (args.Length == 0 && !Console.IsInputRedirected && !Console.IsOutputRedirected
                && GetConsoleProcessList(new uint[2], 2) == 1) {
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
        }
        return result;
    }
}
