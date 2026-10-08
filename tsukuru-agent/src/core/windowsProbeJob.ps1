param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$probeConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

# The job is assigned by CreateProcess itself, before any game thread runs.
# Do not replace JOB_LIST with a post-spawn assignment or allow breakaway.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class TsukuruProbeJob {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic; public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long UserTime, KernelTime, PeriodUser, PeriodKernel;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
        public int Size; public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public ushort ShowWindow, ReservedSize;
        public IntPtr ReservedPointer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo Info; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Size; public IntPtr Descriptor; public int Inherit; }
    public class Outcome {
        public bool started, timedOut, cancelled, processTreeTerminated;
        public int? exitCode;
        public string error;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SecurityAttributes attributes, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    public static Outcome Run(string executable, string[] args, string cwd, int timeout) {
        var outcome = new Outcome { processTreeTerminated = true };
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, jobValue = IntPtr.Zero, handles = IntPtr.Zero, input = IntPtr.Zero;
        bool attributesReady = false;
        var process = new ProcessInfo();
        try {
            // EOF or any byte means the owning Node process has gone away/cancelled.
            var cancellation = Console.OpenStandardInput().ReadAsync(new byte[1], 0, 1);
            if (cancellation.IsCompleted) { outcome.cancelled = true; return outcome; }
            job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero); Check(job != IntPtr.Zero);
            var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size)); attributesReady = true;
            jobValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue, job);
            Check(UpdateProcThreadAttribute(attributes, 0, (IntPtr)0x2000D, jobValue, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero));
            var security = new SecurityAttributes { Size = Marshal.SizeOf(typeof(SecurityAttributes)), Inherit = 1 };
            input = CreateFileW("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero);
            Check(input != new IntPtr(-1));
            IntPtr output = GetStdHandle(-11), error = GetStdHandle(-12);
            Check(SetHandleInformation(output, 1, 1)); Check(SetHandleInformation(error, 1, 1));
            handles = Marshal.AllocHGlobal(3 * IntPtr.Size);
            Marshal.WriteIntPtr(handles, 0, input); Marshal.WriteIntPtr(handles, IntPtr.Size, output); Marshal.WriteIntPtr(handles, 2 * IntPtr.Size, error);
            Check(UpdateProcThreadAttribute(attributes, 0, (IntPtr)0x20002, handles, (IntPtr)(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            var startup = new StartupInfoEx { Attributes = attributes };
            startup.Info.Size = Marshal.SizeOf(typeof(StartupInfoEx));
            startup.Info.Flags = 0x100; startup.Info.Input = input; startup.Info.Output = output; startup.Info.Error = error;
            var command = new StringBuilder(Quote(executable));
            foreach (string argument in args) command.Append(' ').Append(Quote(argument));
            if (cancellation.IsCompleted) { outcome.cancelled = true; return outcome; }
            Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080000, IntPtr.Zero, cwd, ref startup, out process));
            outcome.started = true; outcome.processTreeTerminated = false;
            var clock = Stopwatch.StartNew();
            while (true) {
                uint wait = WaitForSingleObject(process.Process, 25);
                if (wait == 0) { uint code; Check(GetExitCodeProcess(process.Process, out code)); outcome.exitCode = unchecked((int)code); break; }
                if (wait != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (cancellation.IsCompleted) { outcome.cancelled = true; break; }
                if (clock.ElapsedMilliseconds >= timeout) { outcome.timedOut = true; break; }
            }
        } catch (Exception error) { outcome.error = error.Message; }
        finally {
            if (job != IntPtr.Zero) {
                try {
                    Check(TerminateJobObject(job, 1));
                    var deadline = Stopwatch.StartNew();
                    do {
                        Accounting info;
                        Check(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
                        if (info.ActiveProcesses == 0) { outcome.processTreeTerminated = true; break; }
                        Thread.Sleep(20);
                    } while (deadline.ElapsedMilliseconds < 5000);
                    if (!outcome.processTreeTerminated) outcome.error = "Job process termination was not confirmed";
                } catch (Exception error) { outcome.processTreeTerminated = !outcome.started; outcome.error = error.Message; }
                CloseHandle(job);
            }
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
            if (input != IntPtr.Zero && input != new IntPtr(-1)) CloseHandle(input);
            if (attributesReady) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
            if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
        }
        return outcome;
    }
}
'@

$probeOutcome = [TsukuruProbeJob]::Run($probeConfig.executable, [string[]]$probeConfig.args, $probeConfig.cwd, $probeConfig.timeoutMs)
$probeJson = $probeOutcome | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($probeConfig.reportPath, $probeJson, [System.Text.UTF8Encoding]::new($false))
