using System.Collections;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;

// Read-only CPU temperature bridge: FanControl sensor client, or CPU-only
// monitor-library fallback. No fan-control commands, takeover requests,
// configuration changes, driver installation or network listener.
var directory = args.Length > 0 ? Path.GetFullPath(args[0]) : throw new ArgumentException("FanControl directory required");
var output = args.Length > 1 ? Path.GetFullPath(args[1]) : throw new ArgumentException("Output file required");
var once = args.Contains("--once");
if(args.Contains("--replace")) {
    var managedRoot = Path.GetDirectoryName(output)! + Path.DirectorySeparatorChar;
    foreach(var process in System.Diagnostics.Process.GetProcessesByName("phase-fancontrol")) {
        if(process.Id == Environment.ProcessId) continue;
        try {
            var file = Path.GetFullPath(process.MainModule!.FileName);
            if(file.StartsWith(managedRoot,StringComparison.OrdinalIgnoreCase)) { process.Kill(); process.WaitForExit(3000); }
        } catch { /* Never stop an inaccessible or unrelated instance. */ }
    }
}
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
AssemblyLoadContext.Default.Resolving += (context, name) => {
    var file = Path.Combine(directory, name.Name + ".dll");
    return File.Exists(file) ? context.LoadFromAssemblyPath(file) : null;
};
object? client = null;
Assembly? ipc = null;
object? computer = null;
Assembly? monitor = null;
var useLibrary = false;
var stopping = false;
Console.CancelKeyPress += (_, e) => { e.Cancel = true; stopping = true; };

object Call(object client, string name, object request) => client.GetType().GetMethods()
    .Single(m => m.Name == name && m.GetParameters().Length == 4)
    .Invoke(client, new object?[] {request, null, DateTime.UtcNow.AddSeconds(3), CancellationToken.None})!;
object? Property(object target, string name) => target.GetType().GetProperty(name)!.GetValue(target);

while (!stopping) {
    object payload;
    try {
        if(useLibrary) {
            if(computer is null) {
                monitor = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(directory,"LibreHardwareMonitorLib.dll"));
                var type = monitor.GetType("LibreHardwareMonitor.Hardware.Computer",true)!;
                computer = Activator.CreateInstance(type)!;
                type.GetProperty("IsCpuEnabled")!.SetValue(computer,true);
                type.GetMethod("Open")!.Invoke(computer,null);
            }
            var hardwareInterface = monitor!.GetType("LibreHardwareMonitor.Hardware.IHardware",true)!;
            var sensorInterface = monitor.GetType("LibreHardwareMonitor.Hardware.ISensor",true)!;
            var temperatures = new List<(string Name,bool Package,float Value)>();
            foreach(var hardware in (IEnumerable)Property(computer,"Hardware")!) {
                hardwareInterface.GetMethod("Update")!.Invoke(hardware,null);
                foreach(var sensor in (IEnumerable)hardwareInterface.GetProperty("Sensors")!.GetValue(hardware)!) {
                    if(sensorInterface.GetProperty("SensorType")!.GetValue(sensor)!.ToString()!="Temperature") continue;
                    var name=(string)sensorInterface.GetProperty("Name")!.GetValue(sensor)!;
                    var reading=sensorInterface.GetProperty("Value")!.GetValue(sensor);
                    if(name.Contains("Distance",StringComparison.OrdinalIgnoreCase)||name.Contains("TjMax",StringComparison.OrdinalIgnoreCase)) continue;
                    var package=name.Contains("Package",StringComparison.OrdinalIgnoreCase)||name.Contains("Tctl/Tdie",StringComparison.OrdinalIgnoreCase);
                    if((package||name.Contains("Core",StringComparison.OrdinalIgnoreCase)||name.Contains("Tdie",StringComparison.OrdinalIgnoreCase))&&reading is float value&&float.IsFinite(value)&&value>=0&&value<=150) temperatures.Add((name,package,value));
                }
            }
            var packages=temperatures.Where(x=>x.Package).ToArray();
            var selected=(packages.Length>0?packages:temperatures.ToArray()).OrderByDescending(x=>x.Value).FirstOrDefault();
            payload=new{ok=temperatures.Count>0,at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),source="FanControl/LibreHardwareMonitor",cpu=temperatures.Count>0?(float?)selected.Value:null,cpuKind=packages.Length>0?"package":"core-max",sensor=selected.Name,message=temperatures.Count>0?"":"CPU temperature unavailable from monitor library"};
        } else {
        if (client is null) {
            ipc = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(directory, "FanControl.IPC.dll"));
            var factory = ipc.GetType("FanControl.IPC.IPCFactory", true)!;
            var method = factory.GetMethod("GetSensorClient")!;
            client = method.Invoke(method.IsStatic ? null : Activator.CreateInstance(factory), null)!;
        }
        var all = Call(client, "GetAllSensors", Activator.CreateInstance(ipc!.GetType("GetAllSensorsRequest", true)!)!);
        var candidates = new List<(string Id, string Name, bool Package)>();
        foreach (var sensor in (IEnumerable)Property(all, "Sensors")!) {
            var id = (string)Property(sensor!, "Identifier")!;
            var name = (string)Property(sensor!, "Name")!;
            // Never use motherboard CPU/socket sensors, GPU, or distance-to-TjMax.
            if ((!id.StartsWith("/intelcpu/", StringComparison.OrdinalIgnoreCase) && !id.StartsWith("/amdcpu/", StringComparison.OrdinalIgnoreCase)) ||
                !id.Contains("/temperature/") || name.Contains("Distance", StringComparison.OrdinalIgnoreCase) || name.Contains("TjMax", StringComparison.OrdinalIgnoreCase)) continue;
            var package = name.Contains("Package", StringComparison.OrdinalIgnoreCase) || name.Contains("Tctl/Tdie", StringComparison.OrdinalIgnoreCase);
            if (package || name.Contains("Core", StringComparison.OrdinalIgnoreCase) || name.Contains("Tdie", StringComparison.OrdinalIgnoreCase)) candidates.Add((id, name, package));
        }
        var request = Activator.CreateInstance(ipc.GetType("ReadSensorValuesRequest", true)!)!;
        var ids = Property(request, "Ids")!;
        var add = ids.GetType().GetMethod("Add", new[] {typeof(string)})!;
        foreach (var candidate in candidates) add.Invoke(ids, new object[] {candidate.Id});
        var values = Property(Call(client, "ReadSensorValues", request), "Values")!;
        var valid = new List<(string Id, string Name, bool Package, float Value)>();
        var lookup = values.GetType().GetMethods().Single(m => m.Name == "TryGetValue");
        foreach (var candidate in candidates) {
            var arguments = new object?[] {candidate.Id, null};
            if (lookup.Invoke(values, arguments) is true && arguments[1] is float value && float.IsFinite(value) && value >= 0 && value <= 150)
                valid.Add((candidate.Id, candidate.Name, candidate.Package, value));
        }
        var packages = valid.Where(x => x.Package).ToArray();
        var selected = (packages.Length > 0 ? packages : valid.ToArray()).OrderByDescending(x => x.Value).FirstOrDefault();
        payload = new { ok = valid.Count > 0, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            source = "FanControl/IPC", cpu = valid.Count > 0 ? (float?)selected.Value : null,
            cpuKind = packages.Length > 0 ? "package" : "core-max", sensor = selected.Name,
            message = valid.Count > 0 ? "" : "FanControl has no valid CPU temperature reading" };
        }
    } catch (Exception error) {
        var cause = error.GetBaseException();
        if(!useLibrary && cause.Message.Contains("Unimplemented",StringComparison.OrdinalIgnoreCase)) {
            useLibrary=true;
            continue;
        }
        payload = new { ok = false, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), source = "FanControl/IPC", cpu = (float?)null,
            message = cause is UnauthorizedAccessException ? "FanControl IPC access denied: run this read-only bridge with matching administrator rights" : cause.Message };
        client = null;
    }
    var json = JsonSerializer.Serialize(payload);
    File.WriteAllText(output + ".tmp", json);
    File.Move(output + ".tmp", output, true);
    if (once) { Console.WriteLine(json); break; }
    Thread.Sleep(2000);
}
if(computer is not null) computer.GetType().GetMethod("Close")!.Invoke(computer,null);
