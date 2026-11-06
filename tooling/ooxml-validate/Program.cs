// 参考 office-kit/pptx tools/ooxml-validate（MIT，提交 18b7e75cfa7fd1c6e9891ce1285a76c7889b644b）。
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

if (args.Length == 0)
{
    Console.Error.WriteLine("usage: ooxml-validate <file-or-directory> [more...]");
    return 2;
}

var files = args
    .SelectMany(arg => Directory.Exists(arg)
        ? Directory.EnumerateFiles(arg, "*.pptx", SearchOption.AllDirectories)
        : new[] { arg })
    .OrderBy(path => path, StringComparer.Ordinal)
    .ToList();

if (files.Count == 0)
{
    Console.Error.WriteLine("ooxml-validate: no .pptx files matched the given paths");
    return 2;
}

var validator = new OpenXmlValidator(FileFormatVersions.Microsoft365);
var totalErrors = 0;

foreach (var file in files)
{
    if (!File.Exists(file))
    {
        Console.Error.WriteLine($"ooxml-validate: file not found: {file}");
        totalErrors++;
        continue;
    }

    try
    {
        using var doc = PresentationDocument.Open(file, false);
        var errors = validator.Validate(doc).ToList();
        if (errors.Count == 0)
        {
            Console.WriteLine($"OK    {file}");
            continue;
        }

        Console.WriteLine($"FAIL  {file}  ({errors.Count} error(s))");
        foreach (var error in errors)
        {
            Console.WriteLine($"  [{error.Id}] {error.Description}");
            Console.WriteLine($"      part:  {error.Part?.Uri}");
            Console.WriteLine($"      xpath: {error.Path?.XPath}");
        }
        totalErrors += errors.Count;
    }
    catch (Exception ex)
    {
        Console.WriteLine($"FAIL  {file}  (could not be loaded by the Open XML SDK)");
        Console.WriteLine($"  [load-error] {ex.Message}");
        totalErrors++;
    }
}

Console.WriteLine();
Console.WriteLine(totalErrors == 0
    ? $"ooxml-validate: all {files.Count} file(s) passed OpenXmlValidator ({FileFormatVersions.Microsoft365})"
    : $"ooxml-validate: {totalErrors} validation error(s) across {files.Count} file(s)");

return totalErrors == 0 ? 0 : 1;
