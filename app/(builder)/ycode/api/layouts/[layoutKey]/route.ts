import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  LAYOUT_PREVIEW_EXTENSIONS,
  getLayoutPreviewPath,
  isLayoutsApiEnabled,
  isValidLayoutKey,
  toTsStringLiteral,
} from '@/lib/layout-file-utils';

const LAYOUTS_FILE_PATH = path.join(process.cwd(), 'lib', 'templates', 'layouts.ts');

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ layoutKey: string }> }
) {
  if (!isLayoutsApiEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const { layoutKey } = await params;
    const { newLayoutKey, newLayoutName, category } = await request.json();

    if (!layoutKey || !newLayoutKey || !newLayoutName || typeof category !== 'string' || !category) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!isValidLayoutKey(layoutKey) || !isValidLayoutKey(newLayoutKey)) {
      return NextResponse.json(
        { error: 'Layout key may only contain lowercase letters, numbers and dashes' },
        { status: 400 }
      );
    }

    // Read the existing file
    let fileContent = await fs.readFile(LAYOUTS_FILE_PATH, 'utf-8');

    // Check if layout exists
    if (!fileContent.includes(`'${layoutKey}':`)) {
      return NextResponse.json(
        { error: `Layout '${layoutKey}' not found` },
        { status: 404 }
      );
    }

    // If renaming, make the new key unique if it already exists (and it's not the same key)
    let uniqueNewLayoutKey = newLayoutKey;
    if (layoutKey !== newLayoutKey) {
      let counter = 2;
      while (fileContent.includes(`'${uniqueNewLayoutKey}':`) && uniqueNewLayoutKey !== layoutKey) {
        uniqueNewLayoutKey = `${newLayoutKey}-${counter}`;
        counter++;
      }
    }

    // Find the layout entry using a simple approach
    // Step 1: Find the layout start index using the original key
    const layoutStartIndex = fileContent.indexOf(`'${layoutKey}': {`);
    if (layoutStartIndex === -1) {
      return NextResponse.json(
        { error: 'Could not find layout entry' },
        { status: 404 }
      );
    }

    // Step 2: Replace the layout key if renaming
    let searchKey = layoutKey; // Key to use for finding boundaries
    if (layoutKey !== uniqueNewLayoutKey) {
      const keyRegex = new RegExp(`'${layoutKey}':\\s*\\{`, 'g');
      fileContent = fileContent.replace(keyRegex, () => `'${uniqueNewLayoutKey}': {`);
      searchKey = uniqueNewLayoutKey;
    }

    // Find the updated layout position after potential key replacement
    const updatedLayoutStartIndex = fileContent.indexOf(`'${searchKey}': {`);
    if (updatedLayoutStartIndex === -1) {
      return NextResponse.json(
        { error: 'Could not find layout entry after key replacement' },
        { status: 500 }
      );
    }

    // Find the next layout entry or end of object to determine the boundary
    const nextLayoutIndex = fileContent.indexOf('\n  \'', updatedLayoutStartIndex + 1);
    const endOfObjectIndex = fileContent.indexOf('\n};', updatedLayoutStartIndex);
    const layoutEndIndex = nextLayoutIndex !== -1 && nextLayoutIndex < endOfObjectIndex 
      ? nextLayoutIndex 
      : endOfObjectIndex;

    if (layoutEndIndex === -1) {
      return NextResponse.json(
        { error: 'Could not determine layout boundaries' },
        { status: 500 }
      );
    }

    // Extract just this layout's section
    const layoutSection = fileContent.substring(updatedLayoutStartIndex, layoutEndIndex);

    // Update category in this section
    const categoryRegex = /category:\s*'(?:[^'\\]|\\.)*'/;
    const updatedLayoutSection = layoutSection.replace(
      categoryRegex,
      () => `category: ${toTsStringLiteral(category)}`
    );

    // Update preview image path in this section
    const previewImageRegex = /previewImage:\s*'[^']*'/;
    const updatedLayoutSectionWithImage = updatedLayoutSection.replace(
      previewImageRegex,
      () => `previewImage: '/ycode/layouts/previews/${uniqueNewLayoutKey}.webp'`
    );

    // Replace the section in the file
    fileContent = fileContent.substring(0, updatedLayoutStartIndex) + 
                  updatedLayoutSectionWithImage + 
                  fileContent.substring(layoutEndIndex);

    // Write back to file
    await fs.writeFile(LAYOUTS_FILE_PATH, fileContent, 'utf-8');

    return NextResponse.json({
      data: { layoutKey: uniqueNewLayoutKey, layoutName: newLayoutName, category },
      message: 'Layout updated successfully',
    });
  } catch (error) {
    console.error('Error updating layout:', error);
    return NextResponse.json(
      { error: 'Failed to update layout' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ layoutKey: string }> }
) {
  if (!isLayoutsApiEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const { layoutKey } = await params;

    if (!isValidLayoutKey(layoutKey)) {
      return NextResponse.json(
        { error: 'A valid layout key is required' },
        { status: 400 }
      );
    }

    // Read the existing file
    let fileContent = await fs.readFile(LAYOUTS_FILE_PATH, 'utf-8');

    // Check if layout exists
    const layoutStartIndex = fileContent.indexOf(`'${layoutKey}': {`);
    if (layoutStartIndex === -1) {
      return NextResponse.json(
        { error: `Layout '${layoutKey}' not found` },
        { status: 404 }
      );
    }

    // Find the layout boundaries
    const nextLayoutIndex = fileContent.indexOf('\n  \'', layoutStartIndex + 1);
    const endOfObjectIndex = fileContent.indexOf('\n};', layoutStartIndex);
    const layoutEndIndex = nextLayoutIndex !== -1 && nextLayoutIndex < endOfObjectIndex 
      ? nextLayoutIndex 
      : endOfObjectIndex;

    if (layoutEndIndex === -1) {
      return NextResponse.json(
        { error: 'Could not determine layout boundaries' },
        { status: 500 }
      );
    }

    // Check if we need to include the comma from the previous entry
    // Look backwards to find if there's a comma before this entry
    let deleteStartIndex = layoutStartIndex;
    
    // Find the start of the line (including leading whitespace and newline)
    while (deleteStartIndex > 0 && fileContent[deleteStartIndex - 1] !== '\n') {
      deleteStartIndex--;
    }

    // Remove the layout entry
    fileContent = fileContent.substring(0, deleteStartIndex) + fileContent.substring(layoutEndIndex);

    // Clean up any double commas or trailing commas before closing brace
    fileContent = fileContent.replace(/,(\s*),/g, ',');
    fileContent = fileContent.replace(/,(\s*)\n\s*\}/g, '\n}');

    // Write back to file
    await fs.writeFile(LAYOUTS_FILE_PATH, fileContent, 'utf-8');

    // Try to delete the associated image file
    try {
      for (const ext of LAYOUT_PREVIEW_EXTENSIONS) {
        try {
          await fs.unlink(getLayoutPreviewPath(layoutKey, ext));
          break; // Stop after successfully deleting one
        } catch {
          // File doesn't exist with this extension, try next
        }
      }
    } catch (error) {
      console.error('Failed to delete image file:', error);
      // Don't fail the request if image deletion fails
    }

    return NextResponse.json({
      data: { layoutKey },
      message: 'Layout deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting layout:', error);
    return NextResponse.json(
      { error: 'Failed to delete layout' },
      { status: 500 }
    );
  }
}
