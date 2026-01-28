using System.IO;
using UnityEditor;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace Satie.Editor
{
// Turns every .sat file into a TextAsset.
[ScriptedImporter(1, "sat")]
public class SatImporter : ScriptedImporter
{
    public override void OnImportAsset(AssetImportContext ctx)
    {
        var txt = File.ReadAllText(ctx.assetPath);
        var asset = new TextAsset(txt)
        {
            name = Path.GetFileNameWithoutExtension(ctx.assetPath)
        };

        ctx.AddObjectToAsset("text", asset);
        ctx.SetMainObject(asset);
    }
}
}