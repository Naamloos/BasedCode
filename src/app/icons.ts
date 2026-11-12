/**
 * App icon set: Phosphor, regular weight. Exported under the names the components already use, so
 * call sites stay `<Check :size="13" />`.
 */
import { h, type Component, type FunctionalComponent } from 'vue';
import * as Ph from '@phosphor-icons/vue';

type IconProps = { size?: number | string; strokeWidth?: number | string };
type Weight = 'regular';

function icon(base: Component, weight: Weight = 'regular', mirrored = false): FunctionalComponent<IconProps> {
  // strokeWidth is a Lucide-era prop; Phosphor controls stroke through the weight.
  const wrapped: FunctionalComponent<IconProps> = ({ size }, { attrs }) =>
    h(base, { ...attrs, size: size ?? 16, weight, mirrored, class: ['icon', attrs.class] });
  wrapped.props = ['size', 'strokeWidth'];
  return wrapped;
}

export const Check = icon(Ph.PhCheck);
export const X = icon(Ph.PhX);
export const Plus = icon(Ph.PhPlus);
export const Minus = icon(Ph.PhMinus);
export const ChevronDown = icon(Ph.PhCaretDown);
export const ChevronRight = icon(Ph.PhCaretRight);
export const ChevronLeft = icon(Ph.PhCaretLeft);
export const ChevronUp = icon(Ph.PhCaretUp);

export const Activity = icon(Ph.PhActivity);
export const Archive = icon(Ph.PhArchive);
export const ArchiveRestore = icon(Ph.PhBoxArrowUp);
export const ArrowDown = icon(Ph.PhArrowDown);
export const ArrowLeft = icon(Ph.PhArrowLeft);
export const ArrowRightLeft = icon(Ph.PhArrowsLeftRight);
export const ArrowUp = icon(Ph.PhArrowUp);
export const BarChart3 = icon(Ph.PhChartBar);
export const BellRing = icon(Ph.PhBellRinging);
export const Bot = icon(Ph.PhRobot);
export const Brain = icon(Ph.PhBrain);
export const ChartColumn = icon(Ph.PhChartBar);
export const CheckCircle2 = icon(Ph.PhCheckCircle);
export const Circle = icon(Ph.PhCircle);
export const CircleAlert = icon(Ph.PhWarningCircle);
export const CircleCheck = icon(Ph.PhCheckCircle);
export const CircleDot = icon(Ph.PhRecord);
export const CircleX = icon(Ph.PhXCircle);
export const Clock = icon(Ph.PhClock);
export const Coins = icon(Ph.PhCoins);
export const Columns2 = icon(Ph.PhColumns);
export const Command = icon(Ph.PhCommand);
export const Copy = icon(Ph.PhCopy);
export const Cpu = icon(Ph.PhCpu);
export const Download = icon(Ph.PhDownloadSimple);
export const ExternalLink = icon(Ph.PhArrowSquareOut);
export const Eye = icon(Ph.PhEye);
export const EyeOff = icon(Ph.PhEyeSlash);
export const File = icon(Ph.PhFile);
export const FileCode2 = icon(Ph.PhFileCode);
export const FileText = icon(Ph.PhFileText);
export const Flame = icon(Ph.PhFire);
export const Folder = icon(Ph.PhFolder);
export const FolderInput = icon(Ph.PhArrowSquareIn);
export const FolderOpen = icon(Ph.PhFolderOpen);
export const FolderPlus = icon(Ph.PhFolderPlus);
export const Gauge = icon(Ph.PhGauge);
export const GitBranch = icon(Ph.PhGitBranch);
export const GitCommitHorizontal = icon(Ph.PhGitCommit);
export const GitCompareArrows = icon(Ph.PhGitDiff);
export const GitFork = icon(Ph.PhGitFork);
export const GitPullRequest = icon(Ph.PhGitPullRequest);
export const Globe = icon(Ph.PhGlobe);
export const GripVertical = icon(Ph.PhDotsSixVertical);
export const Hand = icon(Ph.PhHand);
export const History = icon(Ph.PhClockCounterClockwise);
export const Image = icon(Ph.PhImage);
export const ImageIcon = Image;
export const Info = icon(Ph.PhInfo);
export const KeyRound = icon(Ph.PhKey);
export const Keyboard = icon(Ph.PhKeyboard);
export const Layers = icon(Ph.PhStack);
export const ListChecks = icon(Ph.PhListChecks);
export const ListPlus = icon(Ph.PhListPlus);
export const LoaderCircle = icon(Ph.PhCircleNotch);
export const LogIn = icon(Ph.PhSignIn);
export const LogOut = icon(Ph.PhSignOut);
export const Maximize2 = icon(Ph.PhArrowsOut);
export const MessageSquare = icon(Ph.PhChatCircle);
export const MessageSquareQuote = icon(Ph.PhQuotes);
export const MoreHorizontal = icon(Ph.PhDotsThree);
export const Navigation = icon(Ph.PhNavigationArrow);
export const Network = icon(Ph.PhGraph);
export const Palette = icon(Ph.PhPalette);
export const PanelLeftClose = icon(Ph.PhSidebarSimple);
export const PanelLeftOpen = icon(Ph.PhSidebarSimple);
export const PanelRightClose = icon(Ph.PhSidebarSimple, 'regular', true);
export const PanelRightOpen = icon(Ph.PhSidebarSimple, 'regular', true);
export const Paperclip = icon(Ph.PhPaperclip);
export const Pause = icon(Ph.PhPause);
export const Pencil = icon(Ph.PhPencilSimple);
export const Pin = icon(Ph.PhPushPin);
export const PinOff = icon(Ph.PhPushPinSlash);
export const Play = icon(Ph.PhPlay);
export const Plug = icon(Ph.PhPlug);
export const RefreshCw = icon(Ph.PhArrowClockwise);
export const Repeat2 = icon(Ph.PhRepeat);
export const RotateCcw = icon(Ph.PhArrowCounterClockwise);
export const Rows2 = icon(Ph.PhRows);
export const Scale = icon(Ph.PhScales);
export const ScrollText = icon(Ph.PhScroll);
export const Search = icon(Ph.PhMagnifyingGlass);
export const Server = icon(Ph.PhHardDrives);
export const Settings2 = icon(Ph.PhGearSix);
export const ShieldAlert = icon(Ph.PhShieldWarning);
export const ShieldCheck = icon(Ph.PhShieldCheck);
export const ShieldQuestion = icon(Ph.PhShield);
export const Shuffle = icon(Ph.PhShuffle);
export const SlidersHorizontal = icon(Ph.PhSliders);
export const Sparkles = icon(Ph.PhSparkle);
export const Square = icon(Ph.PhStop);
export const Terminal = icon(Ph.PhTerminal);
export const TerminalSquare = icon(Ph.PhTerminalWindow);
export const Trash2 = icon(Ph.PhTrash);
export const TriangleAlert = icon(Ph.PhWarning);
export const Trophy = icon(Ph.PhTrophy);
export const Undo2 = icon(Ph.PhArrowUUpLeft);
export const Unplug = icon(Ph.PhPlugs);
export const Upload = icon(Ph.PhUploadSimple);
export const User = icon(Ph.PhUser);
export const WifiOff = icon(Ph.PhWifiSlash);
export const Wrench = icon(Ph.PhWrench);
